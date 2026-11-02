import { Status } from "@/types";
import { RESTART_TIME_CONFIG } from "@test/fixtures/PersistenceRestartStaging";
import { MathTestSession as TestSession } from "@test/harness";
import { expect } from "chai";

describe("StateManager.isActiveFork", function () {
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

describe("StateManager.setChannelId restore", function () {
    it("a restored head clears a persisted dispute marker whose dispute never reached the chain", async function () {
        const h = TestSession.getHarness();
        const forkId = await h.lifecycle.start(2, 1, {
            persistentPeers: [1],
            timeConfig: RESTART_TIME_CONFIG
        });
        // the marker reached disk, then the process died before the upload
        await h.execOnHost(h.getPeer(1), async (sm) => {
            sm.storage.disputes.storeDisputedFork(sm.forkId, true);
            await sm.storage.flush();
        });
        expect(
            await h.control(h.getPeer(1)).query.didIDispute(forkId).request()
        ).to.equal(true);

        const restarted = await h.lifecycle.restartPeer(1);

        expect(
            await h.control(restarted).query.didIDispute(forkId).request()
        ).to.equal(false);
    });

    it("a restored head refills the local mirror with the chain's snapshot before any sync", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(2, 1, {
            persistentPeers: [1],
            timeConfig: RESTART_TIME_CONFIG
        });

        const restarted = await h.lifecycle.restartPeer(1);

        expect(await h.control(restarted).query.getStatus().request()).to.equal(
            Status.SYNCED
        );
        expect(
            await h
                .control(restarted)
                .query.getLocalStateSnapshotStruct()
                .request()
        ).to.deep.equal(
            await h
                .control(h.getPeer(0))
                .query.getLocalStateSnapshotStruct()
                .request()
        );
    });
});
