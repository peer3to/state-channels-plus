// @spec-test-coverage-ignore: real timestamp bytecode and executor assertions shared by mapped tests
import { expect } from "chai";
import type AContractExecutor from "@/evm/contractExecutor/AContractExecutor";
import Clock from "@/Clock";
import { createContractExecutor } from "@/evm/contractExecutor/createContractExecutor";
import { sleep } from "@/utils";

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

export async function assertRuntimeClock(dedicatedThread: boolean) {
    // The component owns this Clock instance; no provider or shared-chain time is changed.
    const instance = Reflect.get(Clock, "instance");
    const previous = Reflect.get(instance, "clockAdjustmentSeconds");
    Reflect.set(instance, "clockAdjustmentSeconds", 600);
    let executor: AContractExecutor | undefined;
    let inline: AContractExecutor | undefined;
    try {
        executor = await createContractExecutor({ dedicatedThread });
        const read = await timestampReader(executor);
        const first = await read();
        if (dedicatedThread) {
            inline = await createContractExecutor({ dedicatedThread: false });
            const inlineRead = await timestampReader(inline);
            expect(
                Math.abs((await inlineRead()) - (await read()))
            ).to.be.at.most(1);
        }
        expect(Math.abs(first - Clock.getTimeInSeconds())).to.be.at.most(1);
        expect(Math.abs(first - (wallSeconds() + 600))).to.be.at.most(1);
        await sleep(1100);
        expect(await read()).to.be.greaterThan(first);
    } finally {
        await executor?.dispose();
        await inline?.dispose();
        Reflect.set(instance, "clockAdjustmentSeconds", previous);
    }
}
