import { type Diagnostic } from '../../lib/diagnostic.ts';

/** Why the encoder found no usable output; disjoint, in the order they become observable. */
export type EncodeOutputReason = 'no-frames' | 'unwritable' | 'empty';

/** Only the install command differs per platform; the other encoder hints are platform-independent. */
const installHint = (): string => {
  if (process.platform === 'darwin') return 'Install FFmpeg with `brew install ffmpeg` and re-run.';
  if (process.platform === 'win32')
    return 'Install FFmpeg with `winget install --id Gyan.FFmpeg` and re-run.';
  if (process.platform === 'linux')
    return 'Install FFmpeg with your package manager (`sudo apt install ffmpeg` on Debian/Ubuntu, `sudo dnf install ffmpeg` from RPM Fusion on Fedora, `sudo pacman -S ffmpeg` on Arch) and re-run.';
  return 'Install FFmpeg from https://ffmpeg.org/download.html and re-run.';
};

/** The binary is missing or not runnable: nothing about the Composition can change that. */
export const ffmpegNotFoundDiagnostic = (binary: string): Diagnostic => ({
  code: 'encode.ffmpeg-not-found',
  severity: 'error',
  message: `The FFmpeg binary "${binary}" could not be run.`,
  hint: installHint(),
  details: { binary },
});

/** The binary ran but is too old, unparseable, or built without H.264 support. */
export const ffmpegUnsupportedDiagnostic = (options: {
  found: string;
  required: string;
  missing: readonly string[];
}): Diagnostic => {
  const lacking = options.missing.length === 0 ? '' : ` without ${options.missing.join(', ')}`;
  return {
    code: 'encode.ffmpeg-unsupported',
    severity: 'error',
    message: `FFmpeg ${options.found} is not supported${lacking}; ${options.required} or newer with libx264 is required.`,
    hint: `Install or upgrade to FFmpeg ${options.required} or newer built with libx264, then re-run; do not disable H.264.`,
    details: { found: options.found, required: options.required, missing: [...options.missing] },
  };
};

/** The child exited non-zero after at least one frame, so its own report is the evidence. */
export const ffmpegFailedDiagnostic = (options: {
  exitCode: number | null;
  signal: string | null;
  stderrTail: string;
}): Diagnostic => ({
  code: 'encode.ffmpeg-failed',
  severity: 'error',
  message:
    options.exitCode === null
      ? `FFmpeg was terminated by ${options.signal ?? 'a signal'} while encoding.`
      : `FFmpeg exited with code ${options.exitCode} while encoding.`,
  hint: 'Read the reported FFmpeg error and fix the composition or the target path; re-running without a change fails the same way.',
  details: { exitCode: options.exitCode, signal: options.signal, stderrTail: options.stderrTail },
});

/** No usable output: zero frames, a sibling the destination directory could not take, or a zero-byte sibling. */
export const outputInvalidDiagnostic = (options: {
  output: string;
  reason: EncodeOutputReason;
}): Diagnostic => ({
  code: 'encode.output-invalid',
  severity: 'error',
  message:
    options.reason === 'no-frames'
      ? 'The Composition produced no frames to encode.'
      : options.reason === 'unwritable'
        ? 'The destination could not accept the encoded file.'
        : 'FFmpeg produced an empty file.',
  hint:
    options.reason === 'no-frames'
      ? 'Check write access and free disk space in the target directory; a zero-frame composition produces no video.'
      : 'Check write access and free disk space in the target directory, then re-run.',
  details: { output: options.output, reason: options.reason },
});

/** A violated encoder invariant, never a usable result: an internal bug, not a user error. */
export const encoderInvariantDiagnostic = (message: string, hint: string): Diagnostic => ({
  code: 'internal.unexpected',
  severity: 'error',
  message,
  hint,
});
