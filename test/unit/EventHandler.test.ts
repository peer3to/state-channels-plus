import { MathTestSession as TestSession } from "@test/harness";
import { expect } from "chai";
import { id as ethersId } from "ethers";

describe("Unit: EventHandler", function () {
    describe("replacement evidence races", function () {
        it("a chain slash whose replacement evidence loses the race leaves the handler successful", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 3);
            const observer = h.getPeer(0);
            const slashed = h.getPeer(1).address;
            // Every honest observer of the same slash uploads evidence, and
            // all but the first are told the evidence period already closed.
            const recorder = await h.rpcStub.recordDisputeSubmissions(
                observer.index,
                {
                    failWith: {
                        customError:
                            "RaceConditionDisputeEvidencePeriodExpired",
                        at: "send"
                    }
                }
            );

            const rejected = await h.execOnHost(
                observer,
                async (sm, args) => {
                    try {
                        await sm.eventHandler.onChainSlashed(
                            sm.channelId,
                            args.slashed,
                            args.timestamp
                        );
                        return "";
                    } catch (error) {
                        return error instanceof Error
                            ? error.message
                            : String(error);
                    }
                },
                { slashed, timestamp: Math.floor(Date.now() / 1000) }
            );

            expect({
                rejected,
                uploads: (await recorder.submissions()).length
            }).to.deep.equal({ rejected: "", uploads: 1 });
            await recorder.restore();
        });

        it("a killed dispute whose replacement evidence loses the race leaves the handler successful", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 3);
            const observer = h.getPeer(0);
            const killed = h.getPeer(1).address;
            const recorder = await h.rpcStub.recordDisputeSubmissions(
                observer.index,
                {
                    failWith: {
                        customError:
                            "RaceConditionDisputeEvidencePeriodExpired",
                        at: "send"
                    }
                }
            );

            const rejected = await h.execOnHost(
                observer,
                async (sm, args) => {
                    try {
                        await sm.eventHandler.onDisputeKilled(
                            sm.channelId,
                            sm.forkId,
                            args.killed,
                            args.disputeHash,
                            args.timestamp
                        );
                        return "";
                    } catch (error) {
                        return error instanceof Error
                            ? error.message
                            : String(error);
                    }
                },
                {
                    killed,
                    disputeHash: ethersId("killed-dispute"),
                    timestamp: Math.floor(Date.now() / 1000)
                }
            );

            expect({
                rejected,
                uploads: (await recorder.submissions()).length
            }).to.deep.equal({ rejected: "", uploads: 1 });
            await recorder.restore();
        });
    });
});
