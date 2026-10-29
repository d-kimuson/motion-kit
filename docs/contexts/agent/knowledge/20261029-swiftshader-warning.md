# SwiftShader warning investigation

On 2026-10-29, a three-frame Three.js render on macOS arm64, Apple M3 Pro, using Playwright 1.64.1 and Chromium headless shell 156.0.8078.4, reported the unmasked renderer `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0) (0x0000C0DE)), SwiftShader driver)`. This exact warning appeared on the page console, forwarded to CLI stderr:

```text
Automatic fallback to software WebGL has been deprecated. Please use the --enable-unsafe-swiftshader flag to opt in to lower security guarantees for trusted content.
```

Direct Playwright WebGL probes measured the same unmasked SwiftShader renderer with motion-kit defaults, `softwareWebGL: true`, and Playwright defaults. Only the motion-kit default warned. Adding `--enable-gpu` to the motion-kit defaults measured `ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Pro, Unspecified Version)` and no warning on this machine. A no-WebGL probe produced no matching warning. These observations do not establish the backend or canvas in the original issue, or performance on other machines; no throughput benchmark was run.

Playwright [supplies the unsafe switch](https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/server/chromium/chromiumSwitches.ts) by default, and motion-kit removes it in its default launch. Chromium's [decoder](https://chromium.googlesource.com/chromium/src/+/main/gpu/command_buffer/service/gles2_cmd_decoder_passthrough.cc) emits the warning for ANGLE SwiftShader without that switch. The measured comparison and [Chromium's SwiftShader documentation](https://chromium.googlesource.com/chromium/src/+/main/docs/gpu/swiftshader.md) support the inference that removing the switch exposes the warning rather than causing software rendering. Chromium's [headless GPU guidance](https://chromium.googlesource.com/chromium/src/+/main/docs/gpu/using-gpu-hardware-in-headless-chrome.md) describes `--enable-gpu`; its effect is platform-dependent.
