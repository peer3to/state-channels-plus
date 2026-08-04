/**
 * Browser twin of the node jumpdest cache: a no-op. The node patch reaches
 * the interpreter through an absolute dist path, which bundlers cannot
 * resolve; browser contract execution is not on the hot path this cache
 * exists for.
 */
export function installEvmJumpdestCache(): void {}

/** Mirrors the node twin's counters; always zero since nothing is cached. */
export const evmJumpdestCacheStats = { analyses: 0, hits: 0 };
