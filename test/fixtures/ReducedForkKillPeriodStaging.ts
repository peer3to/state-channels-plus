// @spec-test-coverage-ignore: reduction staging whose reduced fork opens a dispute before the reduce lands
import type { MathPeerTestHarness } from "./MathPeerTestHarness";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";

/**
 * Peers 0 and 3 install the reduced fork with their reduction sends parked,
 * and peer 0's self-removal opens the reduced fork's window before any reduce
 * lands. Returns the parked sends; the caller releases both.
 */
async function stageReducedForkWindowOpen(h: MathPeerTestHarness) {
    const { sourceForkId } = await h.scenario.stageReducibleDisputedFork({
        peerCount: 4,
        maliciousPeerIndex: 1,
        // the reduced fork's kill period must outlive the reduce below
        timeConfig: { evidenceTime: 8 }
    });
    const snapshotBefore = await h.query.getOnChainSnapshotHash();
    const installer = h.getPeer(0);
    const auditor = h.getPeer(3);
    const reducer = h.getPeer(2);
    const installerSubmit = await h.rpcStub.holdReductionAttempt(
        installer.index,
        "submit"
    );
    const auditorSubmit = await h.rpcStub.holdReductionAttempt(
        auditor.index,
        "submit"
    );
    await h.control(installer).stub.startTryReduce(sourceForkId).request();
    await h.control(auditor).stub.startTryReduce(sourceForkId).request();
    await waitFor(
        async () =>
            (await installerSubmit.entered()) === 1 &&
            (await auditorSubmit.entered()) === 1,
        h.event.protocolEventTimeoutMs()
    );
    const reducedForkId = await h
        .control(installer)
        .query.getForkId()
        .request();
    expect(reducedForkId).to.not.equal(sourceForkId);

    // a real dispute on the reduced fork before the chain knows the fork
    expect(
        await h.execOnHost(
            installer,
            (sm, args) =>
                sm.membershipService.startSelfRemovalDispute(args.forkId),
            { forkId: reducedForkId }
        )
    ).to.equal(true);
    const opened = await h.query.killPeriod(reducedForkId, reducer.index);
    expect(opened.windowExists).to.equal(true);
    expect(opened.isExpired).to.equal(false);
    return {
        sourceForkId,
        reducedForkId,
        snapshotBefore,
        installer,
        reducer,
        installerSubmit,
        auditorSubmit
    };
}

/**
 * The reduce reaches the chain through peer 2's simulation or through peer
 * 0's released send; it must land without adopting the fork.
 */
export async function assertReduceLandsWithoutFrozenForkAdoption(
    h: MathPeerTestHarness,
    path: "simulation" | "send"
): Promise<void> {
    const staged = await stageReducedForkWindowOpen(h);
    const { sourceForkId, reducedForkId, reducer } = staged;
    try {
        if (path === "simulation") {
            await h
                .control(reducer)
                .stub.startTryReduce(sourceForkId)
                .request();
            await waitFor(
                async () =>
                    (
                        await h
                            .control(reducer)
                            .stub.getTryReduceOutcome()
                            .request()
                    )?.settled === true,
                h.event.protocolEventTimeoutMs()
            );
            expect(
                await h.control(reducer).stub.getTryReduceOutcome().request()
            ).to.deep.equal({
                settled: true,
                result: reducedForkId,
                rejected: null
            });
        } else {
            await staged.installerSubmit.release();
        }

        // the reduce landed alone: the chain records the reduced fork and
        // keeps the old snapshot while that fork's kill period is open
        await waitFor(
            async () =>
                String(
                    (
                        await h.channelManager.getReducedResult(
                            h.channelId,
                            sourceForkId
                        )
                    ).reducedForkId
                ) === reducedForkId,
            h.event.protocolEventTimeoutMs()
        );
        expect(await h.query.getOnChainSnapshotHash()).to.equal(
            staged.snapshotBefore
        );
        const stillOpen = await h.query.killPeriod(
            reducedForkId,
            reducer.index
        );
        expect(stillOpen.isExpired).to.equal(false);
    } finally {
        // the parked sends meet the landed reduce
        await staged.installerSubmit.release();
        await staged.auditorSubmit.release();
    }
    expect(
        (await h.quiesceHosts()).map((error) => error.message)
    ).to.deep.equal([]);
}

/**
 * Peer 0's bundled send goes out and is refused for the reduced fork's open
 * window, but its outcome is held until peer 0 has left the channel. The
 * refusal then arrives for a channel the runtime no longer holds, so the
 * reduce-alone resubmission must not be sent.
 */
export async function assertResubmitAfterChannelResetSendsNothing(
    h: MathPeerTestHarness
): Promise<void> {
    const staged = await stageReducedForkWindowOpen(h);
    const { installer } = staged;
    try {
        // Swapping the hold releases the parked gas read and holds the
        // receipt wait of the send that follows it.
        await h
            .control(installer)
            .stub.holdReductionAttempt("sendWait")
            .request();
        await waitFor(
            async () =>
                (await h
                    .control(installer)
                    .stub.getHeldReductionAttemptCount()
                    .request()) === 1,
            h.event.protocolEventTimeoutMs()
        );
        expect(
            await h
                .control(installer)
                .stub.getReductionSubmitCallCount()
                .request()
        ).to.equal(1);

        await h.execOnHost(installer, (sm) => sm.resetChannel());
        await h.control(installer).stub.releaseHeldReductionAttempt().request();
        // The first quiesce settles the refused send, whose handling decides on
        // the resubmission; a resubmission it started is collected after that
        // drain began, so only a second quiesce waits for its chain write.
        await installer.p2pInstance.quiesce();
        await installer.p2pInstance.quiesce();

        expect(
            await h
                .control(installer)
                .stub.getReductionSubmitCallCount()
                .request()
        ).to.equal(1);
    } finally {
        await staged.installerSubmit.release();
        await staged.auditorSubmit.release();
    }
}
