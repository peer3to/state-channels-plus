import { runtimeEndpointFor } from "@test/fixtures/RuntimeRootObservation";
import { MathTestSession as TestSession } from "@test/harness";
import { expect } from "chai";

describe("StateManager.isActiveFork", function () {
    it("rejects the current fork after disposal", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 0, {
            configOverrides: { RUN_SDK_IN_THREAD: false }
        });
        const { sm } = runtimeEndpointFor(h.getPeer(0).p2pInstance);
        const forkId = sm.forkId;
        const before = sm.isActiveFork(forkId);
        await sm.dispose();
        const result = { before, after: sm.isActiveFork(forkId) };
        expect(result).to.deep.equal({ before: true, after: false });
    });

    it("rejects an older fork after a real reduction", async function () {
        const h = TestSession.getHarness();
        const { sourceForkId } = await h.scenario.stageReducibleDisputedFork();
        await h
            .control(h.getPeer(0))
            .stub.startTryReduce(sourceForkId)
            .request();
        await h.dispute.resolveDisputeWait({ forkId: sourceForkId });
        const result = await h.execOnHost(
            h.getPeer(0),
            (sm, args) => ({
                current: sm.isActiveFork(sm.forkId),
                old: sm.isActiveFork(args.oldFork)
            }),
            { oldFork: sourceForkId }
        );
        expect(result).to.deep.equal({ current: true, old: false });
    });
});

describe("StateManager.getActiveValidationStrategy", function () {
    it("participant → chain-committed item gets the calldata strategy, a gossip-only item the live strategy", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 1);
        const result = await h.execOnHost(
            h.getPeer(0),
            (sm) => ({
                committed:
                    sm.getActiveValidationStrategy({ onChainTimestamp: 1 }) ===
                    sm.calldataCommittedStrategy,
                gossip:
                    sm.getActiveValidationStrategy({}) ===
                    sm.blockValidationStrategy,
                bare:
                    sm.getActiveValidationStrategy() ===
                    sm.blockValidationStrategy
            }),
            {}
        );
        expect(result).to.deep.equal({
            committed: true,
            gossip: true,
            bare: true
        });
    });

    it("synced spectator → chain-committed and gossip-only items both get the spectating strategy", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 1);
        const spectator = await h.join.addSpectatorWait();
        const result = await h.execOnHost(
            h.getPeer(spectator.index),
            (sm) => ({
                committed:
                    sm.getActiveValidationStrategy({ onChainTimestamp: 1 }) ===
                    sm.spectatingValidationStrategy,
                gossip:
                    sm.getActiveValidationStrategy({}) ===
                    sm.spectatingValidationStrategy
            }),
            {}
        );
        expect(result).to.deep.equal({ committed: true, gossip: true });
    });
});
