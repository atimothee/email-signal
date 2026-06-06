/**
 * Stub used in the Chrome extension bundle for Node-only packages
 * (weave, ioredis). The runtime never reaches these — the code paths
 * are guarded by `typeof chrome === 'undefined'` — but bundlers
 * statically follow dynamic imports, so we redirect them here.
 */
export default {} as any;
