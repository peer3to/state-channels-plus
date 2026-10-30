// @spec-test-coverage-ignore: controlled chain-first removal during local reduction installation
import type { MathPeerTestHarness } from "./MathPeerTestHarness";
import { Status } from "@/types";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";

export async function assertSyncedLeaverSkipsSubmission(
    h: MathPeerTestHarness
) {
    const { sourceForkId } = await h.scenario.stageReducibleDisputedFork({
        disputingPeerIndices: [2],
        beforeDispute: async () => {
            // The leaver must commit its own dispute; sibling uploads can
            // otherwise consume the evidence window before it submits.
            await h.dispute.suppressDisputeInitiation([0, 1, 3]);
            // The deliberately invalid author must not start an unrelated
            // honest timeout while the leaver submits its dispute.
            await h.rpcStub.suppressTimeoutCheck(1);
            await h.getPeer(2).p2pInstance.p2pSigner.leaveChannel();
        }
    });
    const target = h.getPeer(2);
    await h.assert.dispute.committedWait({
        peersIndices: [0],
        expectedCount: 1
    });
    expect(
        await h.execOnHost(
            target,
            (sm, { forkId }) => sm.storage.disputes.didIDispute(forkId),
            { forkId: sourceForkId }
        )
    ).to.equal(true);
    const events = await h.rpcStub.holdReductionRace(target.index);
    const application = await h.rpcStub.holdReductionGenesisApplication(
        target.index,
        { outcome: "hold", at: "setState" }
    );
    const submit = await h.rpcStub.holdReductionAttempt(target.index, "submit");
    const activeSubmit = await h.rpcStub.holdReductionAttempt(0, "submit");
    try {
        await h.control(target).stub.startTryReduce(sourceForkId).request();
        await waitFor(async () => (await application.entered()) === 1);
        await h
            .control(h.getPeer(0))
            .stub.startTryReduce(sourceForkId)
            .request();
        await waitFor(async () => (await activeSubmit.entered()) === 1);
        expect(await activeSubmit.entered()).to.equal(1);
        await activeSubmit.release();
        await waitFor(
            async () =>
                !(await h.channelManager.getParticipants(h.channelId)).includes(
                    target.address
                ),
            h.event.protocolEventTimeoutMs()
        );
        await application.release();
        await h.event.waitUntilLeftChannel(target.index);
        expect(await h.control(target).query.getStatus().request()).to.equal(
            Status.SYNCED
        );
        // Leave completion can precede the reduction attempt's final reads.
        await waitFor(
            async () =>
                (await h
                    .control(target)
                    .stub.getReductionAttemptsInFlight()
                    .request()) === 0
        );
        // The local install completed: the attempt resolved with the reduced
        // fork the chain records, although the signer left during it.
        expect(
            await h.control(target).stub.getTryReduceOutcome().request()
        ).to.deep.equal({
            settled: true,
            result: await h.query.reducedForkOnChain(sourceForkId),
            rejected: null
        });
        await h.control(target).stub.recordChainMembershipReads().request();
        let settlementReads: number;
        try {
            await h.execOnHost(target, async (sm) => {
                await sm.leaveChannelService["checkLeft"]();
            });
            settlementReads = await h
                .control(target)
                .stub.getChainMembershipReadCount()
                .request();
        } finally {
            await h
                .control(target)
                .stub.restoreChainMembershipReads()
                .request();
        }
        expect(settlementReads).to.equal(0);
        expect(await submit.entered()).to.equal(0);
        expect(
            await h.control(target).stub.getReductionSubmitCallCount().request()
        ).to.equal(0);
    } finally {
        await activeSubmit.release();
        await application.release();
        await submit.release();
        await events.release({ replayEvents: false, keepTasksHeld: true });
    }
}
