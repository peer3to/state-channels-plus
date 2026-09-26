// @spec-test-coverage-ignore: reduction staging whose reduced fork opens a dispute before the reduce lands
import type { MathPeerTestHarness } from "./MathPeerTestHarness";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";

/**
 * Peers 0 and 3 install the reduced fork with their reduction sends parked,
 * and peer 0's self-removal opens the reduced fork's window before any reduce
 * lands. The reduce then reaches the chain through peer 2's simulation or
 * through peer 0's released send; it must land without adopting the fork.
 */
export async function assertReduceLandsWithoutFrozenForkAdoption(
    h: MathPeerTestHarness,
    path: "simulation" | "send"
): Promise<void> {
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
    try {
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
            await installerSubmit.release();
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
        expect(await h.query.getOnChainSnapshotHash()).to.equal(snapshotBefore);
        const stillOpen = await h.query.killPeriod(
            reducedForkId,
            reducer.index
        );
        expect(stillOpen.isExpired).to.equal(false);
    } finally {
        // the parked sends meet the landed reduce
        await installerSubmit.release();
        await auditorSubmit.release();
    }
    expect(
        (await h.quiesceHosts()).map((error) => error.message)
    ).to.deep.equal([]);
}
