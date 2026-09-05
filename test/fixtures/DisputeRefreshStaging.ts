// @spec-test-coverage-ignore: real dispute attempts with controlled upload/read failures
import { expect } from "chai";
import { MathTestSession as TestSession } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";
import type { MathPeerTestHarness } from "./MathPeerTestHarness";

export async function assertDisputeRefreshPolicy(
    h: MathPeerTestHarness,
    mode:
        | "empty"
        | "repeat"
        | "concurrent"
        | "read-failure"
        | "unrelated"
        | "disposed"
        | "ineligible"
): Promise<void> {
    if (mode === "ineligible") {
        await h.lifecycle.start(4, 2);
        await h.scenario.disputeAndResolve({ maliciousPeerIndex: 1 });
        await h.transition.advanceState({ waitForPeers: [0, 2, 3] });
        const constructed = await h.dispute.fetchConstructedDispute(0);
        expect(await h.query.onChainSlashedParticipants(0)).to.include(
            h.getPeer(1).address
        );
        expect(constructed.dispute.input.onChainSlashes).to.not.include(
            h.getPeer(1).address
        );
        expect(constructed.dispute.input.requireExistingDisputeWindow).to.equal(
            true
        );
    } else {
        await h.lifecycle.start(3, 0);
    }
    const peer = h.getPeer(0);
    const recorder = await h.rpcStub.recordDisputeSubmissions(0, {
        hold: mode === "disposed",
        failWith: {
            customError:
                mode === "unrelated"
                    ? "RaceConditionDisputeEvidencePeriodExpired"
                    : "RaceConditionDisputeWindowNotOpen",
            at: "send"
        }
    });
    if (mode === "read-failure") {
        await h.control(peer).stub.stubFailOnChainSlashesRead().request();
    }
    const attempt = h.execOnHost(
        peer,
        async (sm, args) => {
            const recovery = sm.eventSyncService;
            const recover = recovery.recoverOnChainSlashes.bind(recovery);
            let recoveries = 0;
            recovery.recoverOnChainSlashes = async (...parameters) => {
                recoveries += 1;
                return recover(...parameters);
            };
            let error: string | null = null;
            try {
                if (args.mode === "concurrent") {
                    await Promise.all([
                        sm.disputeManager.dispute(sm.forkId),
                        sm.disputeManager.dispute(sm.forkId)
                    ]);
                } else {
                    await sm.disputeManager.dispute(sm.forkId);
                    if (args.mode === "repeat")
                        await sm.disputeManager.dispute(sm.forkId);
                }
            } catch (caught) {
                error =
                    caught instanceof Error ? caught.message : String(caught);
            } finally {
                recovery.recoverOnChainSlashes = recover;
            }
            return {
                recoveries,
                error,
                marker: sm.storage.disputes.didIDispute(sm.forkId)
            };
        },
        { mode }
    );
    try {
        if (mode === "disposed") {
            await recorder.waitUntilHeld();
            await h.control(peer).stub.abortDetached().request();
            await waitFor(async () =>
                h.execOnHost(peer, (sm) => sm.isDisposed)
            );
            await recorder.release();
        }
        const result = await attempt;
        expect(result.marker).to.equal(false);
        expect(result.recoveries).to.equal(
            mode === "unrelated" || mode === "disposed"
                ? 0
                : mode === "repeat" || mode === "concurrent"
                  ? 2
                  : 1
        );
        if (mode === "read-failure")
            expect(result.error).to.contain("authoritative slash read failed");
        else if (mode === "unrelated")
            expect(result.error).to.contain(
                "RaceConditionDisputeEvidencePeriodExpired"
            );
        else expect(result.error).to.equal(null);
        expect(await recorder.submissions()).to.have.length(
            mode === "repeat" || mode === "concurrent" ? 2 : 1
        );
    } finally {
        await recorder.release();
        await recorder.restore();
        if (mode === "read-failure")
            await h.control(peer).stub.restoreOnChainSlashesRead().request();
    }
}

export async function assertBackgroundDisputeFailure(
    h: MathPeerTestHarness,
    runSdkInThread: boolean
): Promise<void> {
    await h.lifecycle.start(3, 2, {
        configOverrides: { RUN_SDK_IN_THREAD: runSdkInThread }
    });
    const peer = h.getPeer(0);
    const { offender, encodedBlock } =
        await h.byzantine.craftInvalidTransitionBlock(peer.index);
    const recorder = await h.rpcStub.recordDisputeSubmissions(peer.index, {
        hold: true,
        failWith: {
            customError: "RaceConditionDisputeWindowNotOpen",
            at: "send"
        }
    });
    await h.control(peer).stub.stubFailOnChainSlashesRead().request();
    let diagnostics: Promise<Error[]> | undefined;
    try {
        await h
            .control(peer)
            .transition.ingestBlockConfirmation(encodedBlock)
            .request();
        await waitFor(async () => (await recorder.submissions()).length === 1);
        // Only the already-entered attempt is under test. Later timeout/event disputes
        // must not supply a different top-level error while this one is observed.
        await Promise.all(
            h.peers.map((other) =>
                h.control(other).stub.stubSuppressDisputeInitiation().request()
            )
        );
        // Attach the normal diagnostic drain while submission is held. The harness's
        // attribution wrapper must not be the source of the top-level report.
        diagnostics = peer.p2pInstance.quiesce();
        await waitFor(
            async () =>
                (await h
                    .control(peer)
                    .stub.getCollectedDetachedPromiseCount()
                    .request()) === 0
        );
        await recorder.release();
        expect(
            await h
                .control(peer)
                .query.getFraudProofType(offender.address)
                .request()
        ).to.not.equal(null);
        // The drain result has no TestSession observer; only the production route can report.
        await waitFor(
            () => TestSession.getFirstDetachedError() !== undefined,
            h.event.protocolEventTimeoutMs()
        );
    } finally {
        await recorder.restore();
        await h.control(peer).stub.restoreOnChainSlashesRead().request();
        await Promise.all(
            h.peers.map((other) =>
                h.control(other).stub.restoreDisputeInitiation().request()
            )
        );
        if (diagnostics) {
            const errors = await diagnostics;
            expect(errors.map((error) => error.message)).to.include(
                "authoritative slash read failed"
            );
        }
    }
}
