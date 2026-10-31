// @spec-test-coverage-ignore: shared reduction disposal staging exercised by the mapped ReductionManager test declarations

import { runtimeIsClosed } from "./RuntimeRootObservation";
import { Status } from "@/types";
import { sleep } from "@/utils";
import type { MathPeerTestHarness } from "@test/fixtures/MathPeerTestHarness";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";

/**
 * Stage a reducible disputed fork on peer 0, hold its reduction at `point`
 * (the attempt, or the genesis application's `setState`), abort while it is
 * held, and release it after the cut: the attempt runs on in the aborted
 * runtime and sends no transaction from peer 0.
 */
export async function assertAbortedReductionSendsNothing(
    h: MathPeerTestHarness,
    point: "attempt" | "setState"
): Promise<void> {
    const { sourceForkId } = await stageDisposalFork(h);
    const target = h.getPeer(0);
    const control = h.control(target);
    const hold =
        point === "attempt"
            ? await h.rpcStub.holdReductionAttempt(0, "attempt")
            : await h.rpcStub.holdReductionGenesisApplication(0, {
                  outcome: "hold",
                  at: "setState"
              });
    // through the control port, so the attempt is this peer's work
    await control.stub.startTryReduce(sourceForkId).request();
    await waitFor(
        async () => (await hold.entered()) === 1,
        h.event.protocolEventTimeoutMs()
    );
    const nonce = await h.provider.getTransactionCount(target.address);
    // the teardown parks after the cut, so the released attempt runs on a
    // live executor and provider and only the signer cut stops its send
    const releaseDisposal = await h.rpcStub.holdRuntimeDisposal(0);
    try {
        await control.stub.abortDetached().request();
        await h.event.waitForPeers("onAbort", [0], 1);
        await hold.release();
        await sleep(1_000);
        expect(await h.provider.getTransactionCount(target.address)).to.equal(
            nonce
        );
    } finally {
        await releaseDisposal();
    }
    await target.p2pInstance.dispose();
}

/**
 * Stage a reducible disputed fork on peer 0 and make the selected read
 * reject after the canonical `setState`; the application aborts the runtime
 * without committing and the caller sees no rejection.
 */
export async function assertReadFailureDuringGenesisApplication(
    h: MathPeerTestHarness,
    at: "getParticipants" | "getNextToWrite"
): Promise<void> {
    const { sourceForkId } = await stageDisposalFork(h);
    const target = h.getPeer(0);
    const { stub, query } = h.control(target);
    const setStateCalls = h.event.getEventCallCount(0, "onSetState");
    const outboundHead = await query.getOutboundHead().request();
    const control = await h.rpcStub.holdReductionGenesisApplication(0, {
        outcome: "reject",
        at
    });
    // keeps the control RPC reachable after the application's abort
    const releaseDisposal = await h.rpcStub.holdRuntimeDisposal(0);
    try {
        await stub.startTryReduce(sourceForkId).request();
        await h.event.waitForPeers("onAbort", [0], 1);
        expect(await control.entered()).to.equal(1);
        await control.release();

        // The application handles the failed read itself: it aborts the state
        // manager and commits nothing; the read error is not the caller's error.
        expect((await stub.getTryReduceOutcome().request())?.settled).to.equal(
            false
        );
        expect(await query.getForkId().request()).to.equal(sourceForkId);
        expect(await query.getStatus().request()).to.equal(Status.OPENED);
        expect(h.event.getEventCallCount(0, "onSetState")).to.equal(
            setStateCalls
        );
        expect(await query.getOutboundHead().request()).to.deep.equal(
            outboundHead
        );
    } finally {
        await releaseDisposal();
    }
    await waitFor(() => runtimeIsClosed(target.p2pInstance));
}

export async function stageDisposalFork(h: MathPeerTestHarness) {
    return await h.scenario.stageReducibleDisputedFork({
        peerCount: 4,
        maliciousPeerIndex: 1,
        disputingPeerIndices: [0],
        beforeDispute: async () => {
            // One real dispute supplies the reduction input. Other uploads
            // are unrelated to disposal and can outlive this short window.
            await h.dispute.suppressDisputeInitiation(
                [1, 2, 3].map((peerIndex) => h.getPeer(peerIndex).index)
            );
        }
    });
}
