// @spec-test-coverage-ignore: shared staging for the mapped dispute signing cases
import type { BlockWorkHoldPoint } from "./customRpc/harnessControl/services/stub/StubService";
import type { MathPeerTestHarness } from "./MathPeerTestHarness";
import { Codec, Type } from "@/utils";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";

export async function assertAdmittedBlockPrecedesDispute(
    h: MathPeerTestHarness,
    point: BlockWorkHoldPoint
): Promise<void> {
    const authoring = point === "authoring";
    await h.lifecycle.start(3, authoring ? 3 : 4);
    const peer = h.getPeer(0);
    const author = h.getPeer(authoring ? 0 : 1);
    const forkId = h.activeForkId!;
    const before = await h
        .control(peer)
        .query.getLatestBlockHeight(forkId)
        .request();
    if (before === null) throw new Error("Missing staged block height");
    const held = await h.rpcStub.holdBlockWork(peer.index, point);
    const recorded = await h.rpcStub.recordDisputeSubmissions(peer.index);
    const write = h.transition.submit(author, (contract) => contract.add(1), {
        waitForSync: false
    });
    try {
        await held.waitUntilEntered();
        await h.execOnHost(peer, (sm) =>
            sm.disputeManager.requestDispute(sm.forkId)
        );
        await waitFor(
            async () =>
                (await h
                    .control(peer)
                    .stub.getStateMutexWaiterCount()
                    .request()) > 0 || (await recorded.submissions()).length > 0
        );
        expect(await recorded.submissions()).to.have.length(0);
        await held.release();
        await write;
        await waitFor(async () => (await recorded.submissions()).length === 1);
        const [submission] = await recorded.submissions();
        const dispute = Codec.decode(submission.encodedDispute, Type.Dispute);
        const state = await h.execOnHost(
            peer,
            (sm, args) => {
                const signed =
                    sm.agreementManager.getLatestSignedBlockByParticipant(
                        args.forkId,
                        sm.signerAddress
                    );
                return {
                    height: signed?.block.height,
                    snapshotHash: signed?.block.stateSnapshotHash,
                    marker: sm.storage.disputes.didIDispute(args.forkId)
                };
            },
            { forkId }
        );
        expect(state.height).to.equal(before + 1);
        expect(state.marker).to.equal(true);
        expect(dispute.input.latestStateSnapshotHash).to.equal(
            state.snapshotHash
        );
    } finally {
        await held.release();
        await write;
        await recorded.restore();
    }
}

export async function assertBlockWorkAfterDisputeRollback(
    h: MathPeerTestHarness,
    authoring: boolean
): Promise<void> {
    await h.lifecycle.start(3, authoring ? 3 : 4);
    const peer = h.getPeer(0);
    const forkId = h.activeForkId!;
    const before = await h
        .control(peer)
        .query.getLatestBlockHeight(forkId)
        .request();
    if (before === null) throw new Error("Missing staged block height");
    const failure = await h.rpcStub.recordDisputeSubmissions(peer.index, {
        failWith: {
            customError: "RaceConditionDisputeEvidencePeriodExpired",
            at: "wait"
        }
    });
    const result = await h.execOnHost(peer, async (sm) => {
        try {
            await sm.disputeManager.dispute(sm.forkId);
        } catch (error) {
            return error instanceof Error ? error.message : String(error);
        }
        return "no error";
    });
    expect(result).to.contain("RaceConditionDisputeEvidencePeriodExpired");
    await failure.restore();
    await h.transition.submit(h.getPeer(authoring ? 0 : 1), (contract) =>
        contract.add(1)
    );
    const signedHeight = await h.execOnHost(
        peer,
        (sm) =>
            sm.agreementManager.getLatestSignedBlockByParticipant(
                sm.forkId,
                sm.signerAddress
            )?.block.height
    );
    expect(signedHeight).to.equal(before + 1);
}

export async function assertDisputedForkDoesNotSign(
    h: MathPeerTestHarness
): Promise<void> {
    // Four blocks: writers 0, 1, 2, 0 → peer 1 is next.
    await h.lifecycle.start(3, 4);
    const disputer = h.getPeer(0);
    const author = h.getPeer(1);
    const forkId = h.activeForkId!;

    // The dispute parks inside its construction, after the marker
    // and before the dispute is stored: the one window in which a
    // delivered block still reaches the signing step.
    const rebuild = await h.rpcStub.holdAuditingDataRebuild(disputer.index);
    const recorder = await h.rpcStub.recordDisputeSubmissions(disputer.index);
    const inFlight = h.execOnHost(
        disputer,
        async (sm, args) => {
            await sm.disputeManager.dispute(args.forkId);
            return sm.storage.disputes.didIDispute(args.forkId);
        },
        { forkId },
        {
            timeoutMs: h.event.hostExecTimeoutMs()
        }
    );
    let delivered: number | null = null;
    try {
        await rebuild.waitUntilHeld();
        // Peer 1's block reaches peer 0 while the dispute is in flight.
        await h.transition.submit(author, (contract) => contract.add(1), {
            waitForPeers: [1, 2]
        });
        delivered = await h
            .control(author)
            .query.getLatestBlockHeight(forkId)
            .request();
    } finally {
        await rebuild.release();
    }
    expect(await inFlight).to.equal(true);
    await recorder.restore();
    // Peer 0 neither signed nor kept the block: a fork it disputes is
    // closed to its signature and dropped by its dead-fork gate.
    const stored = await h
        .control(disputer)
        .query.getBlockByHeight(forkId, delivered!)
        .request();
    expect(stored).to.be.null;
    const signed = await h
        .control(disputer)
        .query.getLatestSignedBlockByParticipant(forkId, disputer.address)
        .request();
    expect(signed?.height).to.be.lessThan(delivered!);
}
