import { timestampReader } from "../fixtures/ExecutorTimestamp.fixture";
import Clock from "@/Clock";
import { createContractExecutor } from "@/evm/contractExecutor/createContractExecutor";
import { expect } from "chai";

// This component has no runtime Clock initialization.
describe("ContractExecutor without a runtime Clock", function () {
    it("the inline factory uses time zero before Clock initialization", async function () {
        expect(Clock.isInitialized()).to.equal(false);
        const executor = await createContractExecutor({
            dedicatedThread: false
        });
        try {
            expect(await (await timestampReader(executor))()).to.equal(0);
        } finally {
            await executor.dispose();
        }
    });
    it("the dedicated factory uses time zero before Clock initialization", async function () {
        expect(Clock.isInitialized()).to.equal(false);
        const executor = await createContractExecutor({
            dedicatedThread: true
        });
        try {
            expect(await (await timestampReader(executor))()).to.equal(0);
        } finally {
            await executor.dispose();
        }
    });
});
