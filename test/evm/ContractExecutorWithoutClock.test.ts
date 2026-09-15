import {
    assertUninitializedExecutorClock,
    timestampReader,
    assertExplicitExecutorClock
} from "../fixtures/ExecutorTimestamp.fixture";
import {
    createSdkOwnedExecutor,
    disposeSdkExecutorFixtures
} from "../fixtures/node/SdkExecutorFixture";
import Clock from "@/Clock";
import { expect } from "chai";
import { ethers } from "hardhat";

describe("ContractExecutor SDK clock initialization", function () {
    afterEach(disposeSdkExecutorFixtures);
    it("keeps timestamp zero without an adjustment or initialized Clock", async () => {
        await assertUninitializedExecutorClock();
    });

    it("initializes the Clock before creating an inline SDK executor", async function () {
        const executor = await createSdkOwnedExecutor({
            dedicatedThread: false
        });
        expect(Clock.isInitialized()).to.equal(true);
        expect(
            Math.abs(
                (await (await timestampReader(executor))()) -
                    Clock.getTimeInSeconds()
            )
        ).to.be.at.most(1);
    });

    it("initializes the Clock before creating a dedicated SDK executor", async function () {
        const executor = await createSdkOwnedExecutor({
            dedicatedThread: true
        });
        expect(Clock.isInitialized()).to.equal(true);
        expect(
            Math.abs(
                (await (await timestampReader(executor))()) -
                    Clock.getTimeInSeconds()
            )
        ).to.be.at.most(1);
    });
    it("uses an explicit zero clock offset even when the shared Clock is initialized", async () => {
        await assertExplicitExecutorClock(0, ethers.provider);
    });
    it("uses an explicit clock offset for an inline root", async () => {
        await assertExplicitExecutorClock(600, ethers.provider);
    });
});
