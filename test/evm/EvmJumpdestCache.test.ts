import { expect } from "chai";
import type { EVM } from "@ethereumjs/evm";
import { Address, hexToBytes } from "@ethereumjs/util";

import { createEvm } from "@/evm/EvmFactory";
import { evmJumpdestCacheStats } from "@platform/evmJumpdestCache";
import { createLogger } from "@/utils";

const logger = createLogger({}, {}, { level: "error" });
const CODE_ADDRESS = new Address(
    hexToBytes("0x00000000000000000000000000000000000000aa")
);

/**
 * Runtime code exercising a JUMP (so jumpdest analysis runs) and PUSH0 (0x5f),
 * which is INVALID before Shanghai and valid from Shanghai on — the observable
 * difference used to prove the cache follows the active hardfork.
 *
 *   PUSH1 0x04  JUMP  INVALID  JUMPDEST  PUSH0  POP  STOP
 */
const PUSH0_AFTER_JUMP = hexToBytes("0x600456fe5b5f5000");

async function runCode(evm: EVM): Promise<{ failed: boolean }> {
    const result = await evm.runCall({
        to: CODE_ADDRESS,
        gasLimit: BigInt(1_000_000),
        data: new Uint8Array()
    });
    return { failed: Boolean(result.execResult.exceptionError) };
}

async function installCode(evm: EVM, code: Uint8Array): Promise<void> {
    await evm.stateManager.putContractCode(CODE_ADDRESS, code);
}

/** Analyses performed (cache misses) while running `body`. */
async function countAnalyses(body: () => Promise<void>): Promise<number> {
    const before = evmJumpdestCacheStats.analyses;
    await body();
    return evmJumpdestCacheStats.analyses - before;
}

describe("EVM jumpdest cache (component)", function () {
    it("analyzes once and then hits the cache for the same stored code", async function () {
        const evm = await createEvm({}, logger);
        await installCode(evm, PUSH0_AFTER_JUMP);

        let first: { failed: boolean } | undefined;
        let second: { failed: boolean } | undefined;
        const firstAnalyses = await countAnalyses(async () => {
            first = await runCode(evm);
        });
        const secondAnalyses = await countAnalyses(async () => {
            second = await runCode(evm);
        });

        // The first execution analyzes; the second must add ZERO analyses —
        // this fails if the cache key is unstable (e.g. rebuilt per call).
        expect(firstAnalyses).to.equal(1);
        expect(secondAnalyses).to.equal(0);
        expect(second).to.deep.equal(first);
    });

    it("executes distinct code buffers independently", async function () {
        const evm = await createEvm({}, logger);
        // Code WITH a jump destination vs code whose jump lands on INVALID.
        const badJump = hexToBytes("0x600456fefe5f5000");
        await installCode(evm, PUSH0_AFTER_JUMP);
        const good = await runCode(evm);
        await installCode(evm, badJump);
        const bad = await runCode(evm);

        expect(good.failed).to.equal(false);
        // A jump into a non-JUMPDEST byte is an invalid jump.
        expect(bad.failed).to.equal(true);
    });

    it("keeps separate EVM instances independent", async function () {
        const first = await createEvm({}, logger);
        const second = await createEvm({}, logger);
        await installCode(first, PUSH0_AFTER_JUMP);
        await installCode(second, PUSH0_AFTER_JUMP);

        expect(await runCode(first)).to.deep.equal(await runCode(second));
    });

    it("follows the active hardfork after it changes, for the same code reference", async function () {
        // PUSH0 is invalid on Paris and valid from Shanghai: if the cache
        // survived the hardfork switch, the second run would reuse Paris
        // opcode data and still fail. Hardfork names are passed as strings
        // because the EVM bundles its own @ethereumjs/common copy, whose enum
        // is a different (incompatible) type from the top-level package's.
        // Drive the EVM's own `common` (the same object a caller-provided
        // one becomes), so the hardforkChanged path under test is identical.
        const evm = await createEvm({}, logger);
        evm.common.setHardfork("paris");
        await installCode(evm, PUSH0_AFTER_JUMP);

        let onParis: { failed: boolean } | undefined;
        let onShanghai: { failed: boolean } | undefined;
        await countAnalyses(async () => {
            onParis = await runCode(evm);
        });
        evm.common.setHardfork("shanghai");
        const afterSwitchAnalyses = await countAnalyses(async () => {
            onShanghai = await runCode(evm);
        });

        // The hardfork switch invalidates the entry: the same code reference
        // is analyzed again against the new opcode table.
        expect(afterSwitchAnalyses).to.equal(1);
        expect(onParis!.failed).to.equal(true);
        expect(onShanghai!.failed).to.equal(false);
    });
});
