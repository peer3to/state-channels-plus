// @spec-test-coverage-ignore: controlled chain-first removal during local reduction installation
import type { MathPeerTestHarness } from "./MathPeerTestHarness";
import { Status } from "@/types";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";

export async function assertSyncedLeaverSkipsSubmission(
    h: MathPeerTestHarness
) {
    let leave: Promise<void> | undefined;
    const { sourceForkId } = await h.scenario.stageReducibleDisputedFork({
        beforeDispute: async () => {
            // The deliberately invalid author must not start an unrelated
            // honest timeout while the other peers submit their disputes.
            await h.rpcStub.suppressTimeoutCheck(1);
            const leaver = h.getPeer(2);
            leave = leaver.p2pInstance.p2pSigner.leaveChannel();
            void leave.catch(() => undefined);
            await h.event.waitUntilLeavePhase(leaver.index, "awaiting-exit");
        }
    });
    const target = h.getPeer(2);
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
        await leave;
        expect(await h.control(target).query.getStatus().request()).to.equal(
            Status.SYNCED
        );
        await h.control(target).stub.recordChainMembershipReads().request();
        let settlementReads: number;
        try {
            await h.execOnHost(target, async (sm) => {
                await sm.leaveChannelService.onSettledStateObserved();
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
        await waitFor(
            async () =>
                (await h
                    .control(target)
                    .stub.getReductionAttemptsInFlight()
                    .request()) === 0
        );
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
