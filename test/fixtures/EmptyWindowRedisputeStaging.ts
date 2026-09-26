import type { MathPeerTestHarness } from "./MathPeerTestHarness";
import { TargetedChannelJoinFixture } from "./TargetedChannelJoinFixture";
import { sleep } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import { id } from "ethers";

/** Whether the reducer under test lands the replacement evidence or is refused. */
export type EmptyWindowOutcome = "wins" | "losesRace";

/**
 * Drive a reducer to the branch where the dispute window it must reduce has
 * expired with no commitments left, so it uploads replacement evidence itself.
 * Every honest peer in that position does the same, so only one upload lands.
 * The winner resumes its reduction; a loser is told the evidence period
 * closed, which is an expected outcome and must not end its participation.
 */
export async function assertEmptyWindowRedispute(
    h: MathPeerTestHarness,
    outcome: EmptyWindowOutcome
): Promise<void> {
    // Four peers race one automatic kill against a window of one-second
    // blocks; the harness evidence floor gives that race room. Approved
    // timeConfig change (plan 30, decision 5).
    await h.scenario.preDisputeSetup({
        peerCount: 4,
        timeConfig: { evidenceTime: 6 }
    });
    const targetPeer = h.getPeer(0);
    const sourceForkId = h.activeForkId!;

    await h.dispute.suppressDisputeInitiation(
        h.peers.map((peer) => peer.index)
    );

    await h.tamper.postTamperedDispute(2, (dispute) => {
        dispute.outputSnapshotDataHash = id("empty-dispute-set-invalid-output");
    });
    await h.event.waitForPeers("onDisputeKilled", [targetPeer.index], 1, {
        mode: "atLeast"
    });
    await waitFor(
        async () =>
            (
                await h.channelManager.getWindowCommitments(
                    h.channelId,
                    sourceForkId
                )
            ).length === 0,
        h.event.protocolEventTimeoutMs(),
        50
    );

    // The replacement dispute may include the independently elapsed block
    // timeout as evidence, so wait past the harness's full timeout window
    // before asking ReductionManager to construct it.
    await sleep(h.event.participantTimeoutWaitMs(1));
    await h.control(targetPeer).stub.restoreDisputeInitiation().request();
    await h.tamper.stubConstructDispute(0, (dispute) => {
        // This scenario is about the emptied on-chain dispute window. A
        // concurrently detected local block timeout is unrelated evidence
        // and can still be too fresh on another peer's clock, so keep the
        // replacement dispute based only on the persisted on-chain slash.
        const zeroAddress = "0x0000000000000000000000000000000000000000";
        dispute.input.timeout = {
            participant: zeroAddress,
            blockHeight: 0,
            minTimeStamp: 0,
            isForced: false,
            previousBlockProducer: zeroAddress,
            previousBlockProducerPostedCalldata: false,
            participantSignatureOnPreviousBlock: "0x"
        };
    });

    // Stand in for the peer that got there first.
    const refused =
        outcome === "losesRace"
            ? await h.rpcStub.recordDisputeSubmissions(targetPeer.index, {
                  failWith: {
                      customError: "RaceConditionDisputeEvidencePeriodExpired",
                      at: "send"
                  }
              })
            : undefined;

    await h.control(targetPeer).dispute.startReduction(sourceForkId).request();

    if (refused) {
        await waitFor(
            async () => (await refused.submissions()).length === 1,
            h.event.protocolEventTimeoutMs(),
            50
        );
        // A refusal that ended participation would be visible here: the
        // reduction manager treats a failed attempt as fatal and aborts.
        await sleep(h.event.participantTimeoutWaitMs(1));
        expect({
            disposed: await new TargetedChannelJoinFixture(h).isDisposed(
                targetPeer
            ),
            uploads: (await refused.submissions()).length
        }).to.deep.equal({ disposed: false, uploads: 1 });
        await refused.restore();
        return;
    }

    await waitFor(
        async () =>
            (
                await h.channelManager.getWindowCommitments(
                    h.channelId,
                    sourceForkId
                )
            ).length > 0,
        h.event.protocolEventTimeoutMs(),
        50
    );
    await waitFor(
        async () =>
            (await h
                .control(targetPeer)
                .query.getCompletedReductionForkId(sourceForkId)
                .request()) !== null,
        h.event.protocolEventTimeoutMs(),
        50
    );
    expect(
        await h
            .control(targetPeer)
            .query.getCompletedReductionForkId(sourceForkId)
            .request()
    ).to.equal(await h.control(targetPeer).query.getForkId().request());
}
