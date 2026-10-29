# MP4 size and quality measurements

On Apple Silicon, 30 frames of `examples/explainer` (600–629, 1920x1080, 30 fps) were captured by `createRenderer` as JPEG quality 95, the format `renderVideo` uses, and encoded through the production image2pipe/mjpeg, limited-range conversion, libx264 medium, yuv420p and faststart path. Matching PNG captures from the same session are the quality reference. This one-second slice is not a universal size guarantee. Encode time includes process startup; no audio was included.

| CRF |  Bytes | Encode ms | PSNR dB |     SSIM |
| --- | -----: | --------: | ------: | -------: |
| 23  | 149467 |       495 |  45.893 | 0.993039 |
| 26  | 112995 |       405 |  44.188 | 0.991055 |
| 28  |  95555 |       483 |  42.861 | 0.989311 |
| 30  |  80936 |       364 |  41.560 | 0.986952 |

For each row, concatenate the ordered JPEG bytes into `ffmpeg -y -f image2pipe -framerate 30/1 -c:v mjpeg -i pipe:0 -c:v libx264 -vf scale=out_range=tv,format=yuv420p -crf N -movflags +faststart -pix_fmt yuv420p -r 30/1 out.mp4`. Measure against the PNG captures with `ffmpeg -i out.mp4 -framerate 30 -i %03d.png -lavfi '[0:v][1:v]psnr;[0:v][1:v]ssim' -f null -`. These figures include JPEG capture loss, unlike the earlier PNG-input measurements; timing varies with load and encoder build.
