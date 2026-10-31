# Vite `/@fs/` cannot serve a file whose name contains `#` or `?`

## Symptom

A file under the project is requested through Vite's dev server as `/@fs/<absolute path>` and answers 404 (or the SPA fallback HTML) when its name contains `#` or `?`, for example `/@fs/.../bgm#1.mp3`. Percent-encoding the character (`%23`, `%3F`) does not help. The same file is served when its name has no such character.

## Workaround

Do not point the browser at `/@fs/`. Serve the file from a route of your own after the access check Vite itself uses:

```ts
import { isFileLoadingAllowed } from 'vite';

if (!isFileLoadingAllowed(server.config, file)) {
  /* respond 403 */
}
// then read `file` and respond with its bytes
```

`isFileLoadingAllowed` applies the `server.fs` allow and deny lists. It does not check the `Host` header: Vite does that in its own middlewares, so a route answering ahead of them must reject a non-loopback `Host` itself, or DNS rebinding lets any page read what it serves. The preview audio route in `src/render/loading/server.ts` does both.

## Why Not Fixed

Vite's `serveRawFsMiddleware` (`node_modules/vite/dist/node/chunks/config.js`) runs `decodeURI` on the pathname and then `encodeURI` on the result before handing it to sirv, which decodes again. `decodeURI` leaves `%23` and `%3F` as they are, `encodeURI` turns the `%` into `%25`, and sirv ends up looking for a file literally named `%23`. A raw `#` or `?` never reaches the pathname because the URL parser treats it as the start of the fragment or query. Fixing it needs Vite to decode the path once; until then, serve such files yourself.
