// @spec-test-coverage-ignore: real timestamp bytecode and executor assertions shared by mapped tests
import {
    createSdkOwnedExecutor,
    disposeSdkExecutorFixtures
} from "./node/SdkExecutorFixture";
import { TestClockProvider } from "./TestClockProvider";
import Clock from "@/Clock";
import type AContractExecutor from "@/evm/contractExecutor/AContractExecutor";
import { createRoot } from "@/rpc/internal/createRoot";
import { ContractExecutorRoot } from "@/rpc/internal/roots/ContractExecutorRoot";
import { sleep } from "@/utils";
import { config } from "@/utils/config";
import { expect } from "chai";
import type { Provider } from "ethers";

export const wallSeconds = () => Math.floor(Date.now() / 1000);
export const TIMESTAMP_INIT_CODE = "0x684260005260206000f360005260096017f3";

export async function timestampReader(executor: AContractExecutor) {
    const deployed = await executor.deploy(TIMESTAMP_INIT_CODE);
    if (!deployed.createdAddress)
        throw new Error("Timestamp reader deployment failed");
    const address = deployed.createdAddress.toString();
    return async () =>
        Number(BigInt((await executor.executeCall("0x", address)).returnValue));
}

export async function deployTimestampStorage(
    executor: AContractExecutor,
    stampInConstructor: boolean
) {
    const runtime = stampInConstructor
        ? "60005460005260206000f3"
        : "426000554260005260206000f3";
    const prefix = stampInConstructor ? "42600055" : "";
    const size = (runtime.length / 2).toString(16).padStart(2, "0");
    const offset = (prefix.length / 2 + 12).toString(16).padStart(2, "0");
    const deployed = await executor.deploy(
        `0x${prefix}60${size}60${offset}60003960${size}6000f3${runtime}`
    );
    if (!deployed.createdAddress)
        throw new Error("Timestamp storage deployment failed");
    return deployed.createdAddress.toString();
}

export async function assertRuntimeClock(
    dedicatedThread: boolean,
    provider: Provider
) {
    // Initialize the real Clock from shifted chain input; the actual chain is unchanged.
    const previous = Clock.getClockAdjustmentSeconds();
    const shifted = new TestClockProvider(provider, 600 - previous);
    await Clock.init(shifted);
    let executor: AContractExecutor | undefined;
    let inline: AContractExecutor | undefined;
    let comparisonClock: TestClockProvider | undefined;
    try {
        executor = await createSdkOwnedExecutor({ dedicatedThread }, {}, () =>
            Clock.init(shifted)
        );
        const read = await timestampReader(executor);
        const first = await read();
        expect(Math.abs(first - Clock.getTimeInSeconds())).to.be.at.most(1);
        const capturedAdjustment = Clock.getClockAdjustmentSeconds();
        if (dedicatedThread) {
            inline = await createSdkOwnedExecutor(
                { dedicatedThread: false },
                {},
                async () => {
                    const block = await provider.getBlock("latest");
                    if (!block)
                        throw new Error(
                            "Clock comparison requires a real block"
                        );
                    comparisonClock = new TestClockProvider(
                        provider,
                        wallSeconds() + capturedAdjustment - block.timestamp
                    );
                    await Clock.init(comparisonClock);
                }
            );
            const inlineRead = await timestampReader(inline);
            expect(
                Math.abs((await inlineRead()) - (await read()))
            ).to.be.at.most(1);
        }
        expect(Clock.getClockAdjustmentSeconds()).to.be.greaterThan(500);
        // Cross a whole-second clock tick; elapsed time is the oracle here.
        await sleep(1100);
        expect(await read()).to.be.greaterThan(first);
    } finally {
        await executor?.dispose();
        await inline?.dispose();
        await disposeSdkExecutorFixtures();
        await Clock.init(provider);
        shifted.destroy();
        comparisonClock?.destroy();
    }
}

export async function assertLiveInlineClock(provider: Provider): Promise<void> {
    await Clock.init(provider);
    // Keep the adjustment larger than setup latency under distributed load.
    const shifted = new TestClockProvider(provider, 600);
    const executor = await createSdkOwnedExecutor({ dedicatedThread: false });
    try {
        const read = await timestampReader(executor);
        const before = await read();
        await Clock.init(shifted);
        const after = await read();
        expect(after - before).to.be.greaterThan(500);
        expect(Math.abs(after - Clock.getTimeInSeconds())).to.be.at.most(1);
    } finally {
        await executor.dispose();
        await disposeSdkExecutorFixtures();
        await Clock.init(provider);
        shifted.destroy();
    }
}

export async function assertExplicitExecutorClock(
    adjustment: number,
    provider: Provider
): Promise<void> {
    const sdk = await createSdkOwnedExecutor({ dedicatedThread: false });
    const shifted = new TestClockProvider(
        provider,
        adjustment + 600 - Clock.getClockAdjustmentSeconds()
    );
    await Clock.init(shifted);
    const root = await createRoot(ContractExecutorRoot, {
        args: {
            config,
            customPrecompiles: [],
            clockAdjustmentSeconds: adjustment
        }
    });
    try {
        expect(Clock.isInitialized()).to.equal(true);
        expect(
            Math.abs(Clock.getTimeInSeconds() - wallSeconds() - adjustment)
        ).to.be.greaterThan(100);
        const read = await timestampReader(root.executor.getExecutor());
        const before = wallSeconds() + adjustment;
        const actual = await read();
        expect(actual).to.be.at.least(before);
        expect(actual).to.be.at.most(wallSeconds() + adjustment);
    } finally {
        await root.dispose();
        await sdk.dispose();
        await disposeSdkExecutorFixtures();
        await Clock.init(provider);
        shifted.destroy();
    }
}

export async function assertUninitializedExecutorClock(): Promise<void> {
    const previous = Clock["instance"];
    Clock["instance"] = undefined;
    const root = await createRoot(ContractExecutorRoot, {
        args: { config, customPrecompiles: [] }
    });
    try {
        expect(Clock.isInitialized()).to.equal(false);
        expect(
            await (
                await timestampReader(root.executor.getExecutor())
            )()
        ).to.equal(0);
    } finally {
        await root.dispose();
        Clock["instance"] = previous;
    }
}
