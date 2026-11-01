// The build aliases `use-sync-external-store/shim` to this module (tsdown.config.ts). Base UI
// imports the CommonJS shim, whose `require("react")` cannot reach the external ESM React of the
// bundled host page; React 19 has the hook itself, which is all the shim exports there.
export { useSyncExternalStore } from 'react';
