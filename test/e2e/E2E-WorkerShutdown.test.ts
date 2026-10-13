import { MathTestSession as TestSession } from "@test/harness";
import { expect } from "chai";

describe("E2E: worker shutdown", function () {
    it("drains and tears down multiple threaded peers promptly", async function () {
        const harness = TestSession.getHarness();
        await harness.lifecycle.start(3, 1, {
            configOverrides: { RUN_SDK_IN_THREAD: true }
        });

        const startedAt = Date.now();
        const cleanup = harness.cleanup();
        expect(harness.cleanup()).to.equal(cleanup);
        await cleanup;
        await harness.cleanup();

        expect(Date.now() - startedAt).to.be.lessThan(5_000);
        expect(harness.peers.length).to.equal(0);
    });

    it("tears down threaded peers promptly right after a block is signed, while the other peers still run it", async function () {
        const harness = TestSession.getHarness();
        await harness.lifecycle.start(3, 1, {
            configOverrides: { RUN_SDK_IN_THREAD: true }
        });
        const writer = harness.getPeer(
            (await harness.query.getNextPeerToWrite()).index
        );
        // resolves once the writer signed its block, before the others run it
        await writer.p2pInstance.p2pContractInstance.add(1);

        const startedAt = Date.now();
        await harness.cleanup();

        expect(Date.now() - startedAt).to.be.lessThan(5_000);
        expect(harness.peers.length).to.equal(0);
    });
});
