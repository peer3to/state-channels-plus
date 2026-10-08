// @spec-test-coverage-ignore: real dispute admission held behind the state mutex
import type { MathPeerTestHarness } from "./MathPeerTestHarness";
import { runtimeEndpointFor } from "./RuntimeRootObservation";
import type {
    ConstructDisputeHold,
    StateMutexHold
} from "@test/harness/actions/rpcStubActions";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";

export async function assertDisputeAdmissionRefuses(
    h: MathPeerTestHarness,
    change: "dispose" | "fork"
) {
    if (change === "dispose") {
        await h.lifecycle.start(3, 0, {
            configOverrides: { RUN_SDK_IN_THREAD: false }
        });
        const { host, sm, stub } = runtimeEndpointFor(h.getPeer(2).p2pInstance);
        const forkId = sm.forkId;
        stub.stubPauseConstructDisputeAtStateProof(forkId);
        stub.holdStateMutex();
        try {
            await waitFor(() => stub.getStateMutexHeldCount() === 1);
            const attempt = sm.disputeManager.dispute(forkId);
            await waitFor(() => stub.getStateMutexWaiterCount() >= 1);
            sm.abort();
            stub.releaseStateMutex();
            await attempt;
            expect(sm.storage.disputes.didIDispute(forkId)).to.equal(false);
            expect(stub.getPausedConstructDisputeStatus().entered).to.equal(0);
        } finally {
            stub.releaseStateMutex();
            stub.restorePausedConstructDispute();
            await host.dispose();
        }
        return;
    }
    // peers exist once staging starts them
    const target = () => h.getPeer(2);
    let construction: ConstructDisputeHold | undefined;
    let mutex: StateMutexHold | undefined;
    let attempt: Promise<boolean> | undefined;
    let reductionHold: { release(): Promise<void> } | undefined;
    let forkId = "";
    try {
        // The dispute must pass its window check while the evidence period
        // is open: after it, a window holding evidence makes it a no-op.
        await h.scenario.stageReducibleDisputedFork({
            beforeDispute: () => h.dispute.suppressDisputeInitiation([2]),
            disputingPeerIndices: [0, 3],
            timeConfig: { evidenceTime: 6 },
            afterDispute: async () => {
                // The target's audit compares its own constructed dispute
                // once per fork, then schedules reduction. Let that finish
                // so the construction hold counts only the parked attempt.
                await waitFor(
                    async () =>
                        (await h
                            .control(target())
                            .stub.getHeldScheduledTaskCount("reduction-")
                            .request()) >= 1
                );
                await h.dispute.restoreDisputeInitiation([2]);
                forkId = await h.control(target()).query.getForkId().request();
                construction = await h.rpcStub.holdConstructDisputeAtStateProof(
                    target().index,
                    forkId
                );
                mutex = await h.rpcStub.holdStateMutex(target().index);
                await waitFor(async () => (await mutex!.entered()) === 1);
                attempt = h.execOnHost(
                    target(),
                    async (sm, args) => {
                        await sm.disputeManager.dispute(args.forkId);
                        return sm.storage.disputes.didIDispute(args.forkId);
                    },
                    { forkId }
                );
                await waitFor(
                    async () =>
                        (await h
                            .control(target())
                            .stub.getStateMutexWaiterCount()
                            .request()) >= 1
                );
            }
        });
        const hold = await h.rpcStub.holdReductionAttempt(0, "submit");
        reductionHold = hold;
        await h.control(h.getPeer(0)).stub.startTryReduce(forkId).request();
        await waitFor(async () => (await hold.entered()) === 1);
        const reducedForkId = await h
            .control(h.getPeer(0))
            .query.getForkId()
            .request();
        expect(reducedForkId).to.not.equal(forkId);
        // Teleport only the fork coordinate while admission is parked;
        // the replacement is a real reduction produced by the other peer.
        await h.execOnHost(
            target(),
            (sm, args) => {
                sm.forkId = args.reducedForkId;
                return true;
            },
            { reducedForkId }
        );
        await mutex!.release();
        expect(await attempt!).to.equal(false);
        expect(await construction!.parkedCount()).to.equal(0);
    } finally {
        await mutex?.release();
        await construction?.release();
        if (forkId) {
            await h.execOnHost(
                target(),
                (sm, args) => {
                    sm.forkId = args.forkId;
                    return true;
                },
                { forkId }
            );
        }
        await reductionHold?.release();
    }
}
