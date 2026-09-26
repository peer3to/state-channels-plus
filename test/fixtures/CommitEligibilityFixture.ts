// @spec-test-coverage-ignore: shared fixture triggers production behavior; executable evidence belongs to its calling test declarations
import { SourceEligibility } from "@/stateManager/membership/MembershipService";
import { Status } from "@/types";
import { MathTestSession } from "@test/harness";
import { expect } from "chai";
import { ethers } from "ethers";

export async function assertCommitCachePreserved() {
    const h = MathTestSession.getHarness();
    await h.lifecycle.start(2, 1, { maxChannelParticipants: 3 });
    const newcomer = ethers.Wallet.createRandom().address;
    await h.transition.insertParticipantOffChain(newcomer, 0n, {
        waitForPeers: [0, 1],
        waitForFinalization: false
    });
    const result = await h
        .control(h.getPeer(0))
        .validation.probeReplayCommitCache(newcomer)
        .request();
    expect(result.before).to.equal(SourceEligibility.ELIGIBLE);
    expect(result.historicalParticipants).not.to.include(newcomer);
    expect(result.after).to.deep.equal(result.before);
    expect(result.heightAfter).to.equal(result.heightBefore);
    expect(result.committed).to.equal(true);
}

export async function assertSpectatorCommit(promote: boolean) {
    const h = MathTestSession.getHarness();
    await h.lifecycle.start(2, 1, { maxChannelParticipants: 3 });
    const { peer: spectator } = await h.join.addSpectatorAuthoring({
        authoringPeerIndices: [0, 1],
        minimumBlocks: 2,
        maximumBlocks: 20
    });
    await h.assert.sync.peersInSyncWait({ waitForFinalization: true });
    const restore = await h.rpcStub.dropNetworkConfirmations(spectator.index);
    const control = h.control(spectator);
    await control.stub.observeAdmission({ holdGossip: true }).request();
    try {
        const before = await control.query
            .getLatestBlockBundle(h.activeForkId!)
            .request();
        if (promote)
            await h.transition.insertParticipantOffChain(
                spectator.address,
                0n,
                { waitForPeers: [0, 1], waitForFinalization: false }
            );
        else
            await h.transition.increment(1, {
                waitForPeers: [0, 1],
                waitForFinalization: false
            });
        const source = h.getPeer(0);
        const next = await h
            .control(source)
            .query.getLatestBlockBundle(h.activeForkId!)
            .request();
        const snapshot = await h
            .control(source)
            .query.getStateSnapshotStructByHash(next!.stateSnapshotHash)
            .request();
        const { encodedState } = await h.execOnHost(
            source,
            (sm, args) => {
                const snapshot =
                    sm.storage.stateSnapshots.getStateSnapshotByHash(
                        args.snapshotHash
                    )!;
                return {
                    encodedState: String(
                        sm.storage.stateMachineStates.getStateMachineState(
                            snapshot.stateMachineStateHash
                        )
                    )
                };
            },
            { snapshotHash: next!.stateSnapshotHash }
        );
        const result = await control.validation
            .commitPreparedSnapshot(
                next!.encodedBlockConfirmation,
                snapshot!.encodedSnapshot,
                encodedState
            )
            .request();
        expect(result.height).to.equal(before!.height + 1);
        expect(result.hash).to.equal(next!.hash);
        expect(result.snapshotHash).to.equal(next!.stateSnapshotHash);
        expect(result.encodedState).to.equal(encodedState);
        expect(result.callbackCalled).to.equal(true);
        expect(result.signedBySelf).to.equal(promote);
        expect(result.eligibility).to.equal(
            promote ? SourceEligibility.ELIGIBLE : SourceEligibility.ABSENT
        );
        expect(result.status).to.equal(
            promote ? Status.PARTICIPATING : Status.SYNCED
        );
        const observation = await control.stub
            .getAdmissionObservation()
            .request();
        expect(observation.broadcasts).to.equal(promote ? 1 : 0);
    } finally {
        await restore();
        await control.stub.restoreAdmissionObservation().request();
    }
}
