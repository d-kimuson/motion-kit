# MP4 size and quality controls

## Decision

The encoder defaults to libx264 CRF 28, its medium preset, yuv420p and MP4 faststart. On the [one-second 1080p explainer slice](../knowledge/20261029-mp4-size-quality-measurements.md), captured as production JPEG quality 95, CRF 28 reduced size from 149467 to 95555 bytes against CRF 23, with PSNR 42.861 dB and SSIM 0.989311 against PNG reference captures; CRF 30 was smaller but lost more quality. These measurements justify a trade-off, not a universal size guarantee.

The internal Encoder accepts CRF 0–51 or a positive video bitrate in kbps, but not both, an x264 preset and output dimensions. The CLI exposes `--video-crf`, `--video-bitrate`, `--scale` and `--fps` only for MP4. Dimensions must be positive and even; a factor applies to the Composition viewport. FFmpeg scales with lanczos after JPEG range conversion, without re-layout. Audio remains AAC 192 kbps.

For output rate, the Time Module computes the ceiling frame count from Composition duration. Output frame i samples the source frame containing its presentation time, using floor; capture only those frames. The audio declarations stay on the source timebase and output is limited to the Composition's exclusive end. The last video frame can cross that end because constant-rate frames occupy whole intervals; container and ffprobe durations can round. For 7 frames at 30 fps, FFmpeg reported 6 frames and 0.250000 s at 24 fps, and 7 frames and 0.233567 s at 30000/1001 fps, against a source duration of 0.233333… s. No claim of identical measured stream durations is made.

## Target size

CRF controls quality, not size. To estimate video bitrate, subtract audio bitrate (192 kbps when audio is present) and container overhead from `target_bytes * 8 / duration_seconds / 1000`. Leave margin: single-pass bitrate, AAC and container overhead can deviate from the estimate. No hard target-size mode or second encode is promised.

## Alternatives

A mandatory second encode wastes capture and encoding work. A hard size guarantee cannot follow from single-pass rate control. Upsampling FPS invents source frames, and scaling the viewport would re-layout the Composition rather than resize its output.
