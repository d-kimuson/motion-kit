# Batch still capture measurement

On 2026-10-29, a local run captured 12 non-contiguous frames (0, 10, …, 110) of a 64×64, 120-frame Composition with Node and the built CLI. The same Composition and output format were used for both runs. Wall time was measured around each CLI process with `performance.now()`; `DEBUG=pw:browser` counted connected browser sessions as a proxy for launches.

| Route                                         |      Wall time | Browser sessions |
| --------------------------------------------- | -------------: | ---------------: |
| One invocation, `--frame 0,10,...,110`        |        1.550 s |                1 |
| Twelve single-frame invocations, sequentially | 13.310 s total |               12 |

This is one local observation, not a performance guarantee. The batch used about 8.6 times less elapsed time in this run; startup costs, image size, platform and load change the result.
