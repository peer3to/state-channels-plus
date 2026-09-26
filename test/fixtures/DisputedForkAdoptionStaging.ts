// @spec-test-coverage-ignore: staging for adopting a fork disputed while its reduce was pending
import type { ForkId } from "@/types";
import type { MathPeerTestHarness } from "@test/fixtures/MathPeerTestHarness";
import { MathTestSession as TestSession } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";

const PEER_COUNT = 4;

async function chainForkOf(h: MathPeerTestHarness): Promise<ForkId> {
    return (await h.channelManager.getStateSnapshot(h.channelId))
        .forkId as ForkId;
}

async function reducedResultOf(
    h: MathPeerTestHarness,
    forkId: ForkId
): Promise<ForkId> {
    return (await h.channelManager.getReducedResult(h.channelId, forkId))
        .reducedForkId as ForkId;
}

async function localForkOf(h: MathPeerTestHarness): Promise<ForkId> {
    return await h.control(h.getPeer(0)).query.getForkId().request();
}

// the one artificial element: every peer's reduce send is held, modelling a
// reduce transaction still pending when the reduced fork is disputed
async function holdReduceSubmits(h: MathPeerTestHarness) {
    const holds = await Promise.all(
        h.peers.map((peer) =>
            h.rpcStub.holdReductionAttempt(peer.index, "submit")
        )
    );
    return {
        release: async () => {
            for (const hold of holds) await hold.release();
        }
    };
}

// the peers install the reduced fork, and an honest timeout dispute opens its
// window while every reduce is pending
async function reduceOntoDisputedFork(
    h: MathPeerTestHarness,
    fromForkId: ForkId
): Promise<ForkId> {
    const held = await holdReduceSubmits(h);
    let reducedForkId: ForkId | undefined;
    try {
        await waitFor(
            async () => (await localForkOf(h)) !== fromForkId,
            h.event.protocolEventTimeoutMs()
        );
        reducedForkId = await localForkOf(h);
        const forkId = reducedForkId;
        await waitFor(
            async () => (await h.query.killPeriod(forkId, 0)).windowExists,
            h.event.protocolEventTimeoutMs()
        );
    } finally {
        await held.release();
    }
    const forkId = reducedForkId;
    await waitFor(
        async () => (await reducedResultOf(h, fromForkId)) === forkId,
        h.event.protocolEventTimeoutMs()
    );
    return forkId;
}

export async function assertDisputedForkAdoptionLandsWithItsReduce(): Promise<void> {
    const h = TestSession.getHarness();
    await h.scenario.preDisputeSetup({
        peerCount: PEER_COUNT,
        timeConfig: { agreementTime: 3, evidenceTime: 4 }
    });
    const forkE = h.activeForkId! as ForkId;

    await h.byzantine.submitInvalidStateTransitionBlock(1);
    await h.assert.dispute.initiatedAndCommitedWait({ expectedCount: 1 });
    const forkF = await reduceOntoDisputedFork(h, forkE);

    // the reducer's bundled adoption landed with the reduce, inside F's kill period
    expect(await chainForkOf(h)).to.equal(forkF);
    const killF = await h.query.killPeriod(forkF, 0);
    expect(killF.windowExists).to.equal(true);
    expect(killF.isExpired).to.equal(false);
}
