// @spec-test-coverage-ignore: real dispute admission held behind the state mutex
import type { MathPeerTestHarness } from "./MathPeerTestHarness";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";

export async function assertDisputeAdmissionRefuses(
    h: MathPeerTestHarness,
    change: "dispose" | "fork"
) {
    let reductionHold:
        | { entered(): Promise<number>; release(): Promise<void> }
        | undefined;
    if (change === "fork") {
        await h.scenario.stageReducibleDisputedFork({
            beforeDispute: () => h.dispute.suppressDisputeInitiation([2]),
            disputingPeerIndices: [0, 3]
        });
        await h.dispute.restoreDisputeInitiation([2]);
        reductionHold = await h.rpcStub.holdReductionAttempt(0, "submit");
    } else {
        await h.lifecycle.start(3, 0);
    }
    const target = h.getPeer(2);
    const forkId = await h.control(target).query.getForkId().request();
    const construction = await h.rpcStub.holdConstructDisputeAtStateProof(
        target.index,
        forkId
    );
    const mutex = await h.rpcStub.holdStateMutex(target.index);
    try {
        await waitFor(async () => (await mutex.entered()) === 1);
        const attempt = h.execOnHost(
            target,
            async (sm, args) => {
                await sm.disputeManager.dispute(args.forkId);
                return sm.storage.disputes.didIDispute(args.forkId);
            },
            { forkId }
        );
        await waitFor(
            async () =>
                (await h
                    .control(target)
                    .stub.getStateMutexWaiterCount()
                    .request()) >= 1
        );
        if (change === "dispose") {
            await h.control(target).stub.abortDetached().request();
            await waitFor(() => h.execOnHost(target, (sm) => sm.isDisposed));
        } else {
            await h.control(h.getPeer(0)).stub.startTryReduce(forkId).request();
            await waitFor(async () => (await reductionHold!.entered()) === 1);
            const reducedForkId = await h
                .control(h.getPeer(0))
                .query.getForkId()
                .request();
            expect(reducedForkId).to.not.equal(forkId);
            // Teleport only the fork coordinate while admission is parked;
            // the replacement is a real reduction produced by the other peer.
            await h.execOnHost(
                target,
                (sm, args) => {
                    sm.forkId = args.reducedForkId;
                    return true;
                },
                { reducedForkId }
            );
        }
        await mutex.release();
        expect(await attempt).to.equal(false);
        expect(await construction.parkedCount()).to.equal(0);
    } finally {
        await mutex.release();
        await construction.release();
        if (change === "fork") {
            await h.execOnHost(
                target,
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
