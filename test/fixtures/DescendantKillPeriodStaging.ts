// @spec-test-coverage-ignore: staging for the descendant kill-period adoption regression
import { StateSnapshot } from "@/models";
import type { ForkId } from "@/types";
import { tryDecodeCustomError } from "@/utils";
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
        // released together: everything after the release has to fit
        // inside the reduced fork's kill period
        release: async () => {
            await Promise.all(holds.map((hold) => hold.release()));
        }
    };
}

// the peers install the next reduced fork, an honest timeout dispute opens its
// window while every reduce is pending, then the reduce lands alone
async function reduceAloneOntoDisputedFork(
    h: MathPeerTestHarness,
    fromForkId: ForkId,
    seenForkIds: ForkId[]
): Promise<ForkId> {
    const held = await holdReduceSubmits(h);
    let reducedForkId: ForkId | undefined;
    try {
        await waitFor(
            async () => !seenForkIds.includes(await localForkOf(h)),
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

export async function assertAncestorAdoptionRefusedDuringDescendantKillPeriod(): Promise<void> {
    const h = TestSession.getHarness();
    await h.scenario.preDisputeSetup({
        peerCount: PEER_COUNT,
        timeConfig: { agreementTime: 3, evidenceTime: 4 }
    });
    const forkE = h.activeForkId! as ForkId;

    await h.byzantine.submitInvalidStateTransitionBlock(1);
    await h.assert.dispute.initiatedAndCommitedWait({ expectedCount: 1 });
    const forkF = await reduceAloneOntoDisputedFork(h, forkE, [forkE]);
    // F's genesis snapshot is fixed once F exists, so it is read before G's
    // kill period starts: only the release, the reduce and the attack run
    // inside that period
    const genesisF = await h
        .control(h.getPeer(0))
        .dispute.getGenesisSnapshotStruct(forkF)
        .request();
    expect(genesisF).to.not.equal(null);
    const forkG = await reduceAloneOntoDisputedFork(h, forkF, [forkE, forkF]);

    // G's disputer adopts the expired F directly to shrink the chain set
    const attacker = h.channelManager.connect(h.getPeer(3).signer);
    const refusal = await attacker
        .updateStateSnapshotFork(
            h.channelId,
            StateSnapshot.decode(genesisF!.encodedSnapshot).toStruct(),
            []
        )
        .then(
            () => null,
            (error: unknown) => tryDecodeCustomError(error)
        );
    // the refusal naming G proves G was inside its kill period at the attack
    expect(refusal?.name).to.equal("RaceConditionSnapshotUpdateDisputedFork");
    expect(refusal?.errorDescription.args[1]).to.equal(forkG);

    // the attack adopted nothing: the chain is not on F (it may already have
    // moved to G legitimately once G's kill period ended), F is past its kill
    // period and G's window exists
    expect(await chainForkOf(h)).to.not.equal(forkF);
    expect((await h.query.killPeriod(forkF, 0)).isExpired).to.equal(true);
    expect((await h.query.killPeriod(forkG, 0)).windowExists).to.equal(true);
}
