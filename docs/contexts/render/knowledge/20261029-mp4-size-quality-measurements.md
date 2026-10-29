# MP4 size and quality measurements

On Apple Silicon, 30 PNG captures of `examples/explainer` frames 600–629 at 1920x1080 and 30 fps were encoded with system FFmpeg and libx264, yuv420p and faststart. This is a one-second slice, not the 395.5-second motivating video; content and encoder builds affect the result. Encode time is elapsed wall time including process startup.

| CRF | Preset |  Bytes | Encode ms | PSNR dB |     SSIM |
| --- | ------ | -----: | --------: | ------: | -------: |
| 23  | medium | 148123 |       583 |  46.996 | 0.993957 |
| 28  | medium |  93801 |       578 |  43.327 | 0.989616 |
| 30  | medium |  79742 |       523 |  41.774 | 0.987223 |
| 28  | slow   |  94066 |       545 |  43.415 | 0.989586 |

The captures came from `createRenderer` and `renderFrame` in a single session. For each row: `ffmpeg -framerate 30 -i %03d.png -c:v libx264 -crf N -preset PRESET -pix_fmt yuv420p -movflags +faststart out.mp4`. Quality was measured against those PNGs with `ffmpeg -i out.mp4 -framerate 30 -i %03d.png -lavfi '[0:v][1:v]psnr;[0:v][1:v]ssim' -f null -`. Production captures JPEG quality 95, so these PNG-input numbers are not a measurement of the complete production path. No audio was included.
