// @spec-test-coverage-ignore: contract-send hold composition is test infrastructure
import { expect } from "chai";
import { MathTestSession as TestSession } from "@test/harness";

describe("contract send holds", function () {
    it("preserves simulation and the outer submission recorder through snapshot-send release", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(2, 0);
        const peer = h.getPeer(0);
        const reduction = await h.rpcStub.holdReductionAttempt(0, "submit");
        const snapshot = await h.rpcStub.holdSnapshotPostSend(0);
        try {
            expect(
                await h.execOnHost(
                    peer,
                    async (sm) =>
                        (
                            await sm.stateChannelManagerContract.multicall.staticCall(
                                []
                            )
                        ).length
                )
            ).to.equal(0);
            await snapshot.release();
            expect(
                await h.execOnHost(
                    peer,
                    async (sm) =>
                        (
                            await sm.stateChannelManagerContract.multicall.staticCall(
                                []
                            )
                        ).length
                )
            ).to.equal(0);
            await h.execOnHost(peer, async (sm) => {
                await (
                    await sm.stateChannelManagerContract.multicall([])
                ).wait();
                return true;
            });
            expect(
                await h
                    .control(peer)
                    .stub.getReductionSubmitCallCount()
                    .request()
            ).to.equal(1);
        } finally {
            await snapshot.release();
            await reduction.release();
        }
        expect(
            await h.execOnHost(
                peer,
                async (sm) =>
                    (
                        await sm.stateChannelManagerContract.multicall.staticCall(
                            []
                        )
                    ).length
            )
        ).to.equal(0);
    });
});
