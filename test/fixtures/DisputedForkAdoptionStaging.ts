// @spec-test-coverage-ignore: staging for a reduce that lands alone onto a fork disputed while it was pending
import type { ForkId } from "@/types";
import type { MathPeerTestHarness } from "@test/fixtures/MathPeerTestHarness";
import { MathTestSession as TestSession } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import { ZeroHash } from "ethers";

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

export async function assertReduceLandsAloneThenLatestForkAdopted(): Promise<void> {
    const h = TestSession.getHarness();
    await h.scenario.preDisputeSetup({
        peerCount: PEER_COUNT,
        timeConfig: { agreementTime: 3, evidenceTime: 4 }
    });
    const forkE = h.activeForkId! as ForkId;

    await h.byzantine.submitInvalidStateTransitionBlock(1);
    await h.assert.dispute.initiatedAndCommitedWait({ expectedCount: 1 });
    const forkF = await reduceOntoDisputedFork(h, forkE);

    // E's reduce landed alone; F is the latest fork but disputed -> the follow-up post adopts nothing
    expect(await chainForkOf(h)).to.equal(forkE);
    const killF = await h.query.killPeriod(forkF, 0);
    expect(killF.windowExists).to.equal(true);

    // once F reduces, the reducer's follow-up post adopts the latest undisputed fork
    await h.dispute.resolveDisputeWait({ forkId: forkF });
    // the harness's chain read can trail the peers' view of the reduce under load
    let forkG = ZeroHash as ForkId;
    await waitFor(async () => {
        forkG = await reducedResultOf(h, forkF);
        return forkG !== ZeroHash;
    }, h.event.protocolEventTimeoutMs());
    expect(forkG).to.not.equal(forkF);
    await waitFor(
        async () => (await chainForkOf(h)) === forkG,
        h.event.protocolEventTimeoutMs()
    );
}
