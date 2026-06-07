/**
 * Build-time constants injected by Vite's `define` (see vite.config.ts and
 * vite.sidepanel.config.ts). `__BUILD_TIMESTAMP__` is stamped when the bundle's
 * build (or watcher) starts, so the side panel can show which build is actually
 * running — the fastest way to catch a stale `dist/` (issue #73).
 */
declare const __BUILD_TIMESTAMP__: string;
