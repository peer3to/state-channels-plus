import * as path from "node:path";

type JumpdestAnalysis = {
    jumps: Uint8Array;
    pushes: Record<number, bigint>;
    opcodesCached: unknown[];
};

type InterpreterInternals = {
    /** `opcodes` is the STABLE active table; `getActiveOpcodes()` rebuilds it. */
    _evm: { readonly opcodes: object };
    _getValidJumpDests(code: Uint8Array): JumpdestAnalysis;
};

/** Miss/hit counters for the cache's component test and diagnostics. */
export const evmJumpdestCacheStats = { analyses: 0, hits: 0 };

let isInstalled = false;

/**
 * Installs a code-keyed cache for @ethereumjs/evm's jumpdest analysis.
 *
 * The 3.x (and 10.x) interpreter re-scans the FULL contract bytecode on every
 * message call (`_getValidJumpDests`) — profiling showed this at ~25% of all
 * EVM CPU for large viaIR facets behind a diamond, where every transition and
 * view call re-analyzes the same deployed code. The state manager returns the
 * same code buffer instance across calls, so caching by (EVM instance, code
 * reference) turns the repeat scans into WeakMap hits. Same reference means
 * same bytes (deployed code is never mutated), and keying per EVM keeps each
 * cache tied to that EVM's opcode table. A fresh buffer simply misses and
 * re-analyzes — never wrong, at worst the old cost.
 *
 * The Interpreter class is not part of the package's `exports`; the absolute
 * dist path (which `exports` does not gate) is the supported escape hatch for
 * this node-only patch. The browser twin is a no-op.
 */
export function installEvmJumpdestCache(): void {
    if (isInstalled) return;
    isInstalled = true;

    const interpreterPath = path.join(
        path.dirname(require.resolve("@ethereumjs/evm")),
        "interpreter.js"
    );
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Interpreter } = require(interpreterPath) as {
        Interpreter: { prototype: InterpreterInternals };
    };

    // Keyed by the ACTIVE OPCODE TABLE object, which the EVM replaces on a
    // hardfork change — so a hardfork switch starts a fresh cache generation
    // instead of serving stale opcode data.
    const cachesByOpcodes = new WeakMap<
        object,
        WeakMap<Uint8Array, JumpdestAnalysis>
    >();
    const original = Interpreter.prototype._getValidJumpDests;
    Interpreter.prototype._getValidJumpDests = function (
        this: InterpreterInternals,
        code: Uint8Array
    ): JumpdestAnalysis {
        // The `opcodes` GETTER returns the current table object and is stable
        // within a hardfork; `getActiveOpcodes()` would rebuild it on every
        // call, making each lookup a fresh key and every call a miss.
        const opcodes = this._evm.opcodes;
        let byCode = cachesByOpcodes.get(opcodes);
        if (!byCode) {
            byCode = new WeakMap();
            cachesByOpcodes.set(opcodes, byCode);
        }
        const cached = byCode.get(code);
        if (cached) {
            evmJumpdestCacheStats.hits += 1;
            return cached;
        }
        evmJumpdestCacheStats.analyses += 1;
        const analysis = original.call(this, code);
        byCode.set(code, analysis);
        return analysis;
    };
}
