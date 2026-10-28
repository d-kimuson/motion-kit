# A long local render fails midway with render.frame-timeout or render.page-error

## Symptom

A full-length `render` of a long Composition (observed: `examples/explainer`, 6660 frames at 1920x1080, about 29 minutes) stops partway with no change to the inputs:

```sh
node dist/cli.js render examples/explainer/entry.tsx --composition explainer --props '{"assets":"final"}' --out out/explainer.mp4 --json
```

- `render.frame-timeout` ("Frame settlement or capture exceeded the frame deadline.") at frame 224 after 18 minutes, with the process at about 5% CPU. The run was not under `caffeinate`, the low CPU fits a machine that idled or slept, and the same command under `caffeinate -i` has not hit it since — the sleep is inferred from that, not observed.
- `render.page-error` ("The frame transport or page failed.") at frame 431 after 115 seconds, under `caffeinate -i`. The diagnostic carries no cause.

A `frame` command at the failing frame succeeds in about 2 seconds, and re-running the identical `render` command succeeded (28m47s).

## Workaround

1. Run a long render under `caffeinate -i` so the machine does not sleep: `caffeinate -i node dist/cli.js render ...`.
2. On `render.frame-timeout` or `render.page-error` at a frame that `frame --frame <n>` renders fine, re-run the same command unchanged. Do not change the Composition to chase it.
3. If it fails repeatedly at the same frame, then it is a real defect: check `frame` at and around that frame, and do not retry blindly.

## Why Not Fixed

The `render.frame-timeout` case is most likely the host sleeping (inferred, see Symptom); a deadline that runs across sleep is not something the renderer can tell from a hung frame. The `render.page-error` cause is unknown because the bare `catch {` in `src/render/capture/frame.ts` drops the underlying exception, so the diagnostic cannot say whether the page, the transport, or Chromium failed (TASK-219 surfaces it). Delete this troubleshot once the cause is surfaced and the failure is either fixed or documented in the diagnostic's hint.
