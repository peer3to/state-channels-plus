import StateSnapshot from "@/models/StateSnapshot";
import { DisputeFraudProofType } from "@/types/sol-enums";
import { Codec, hash, Type } from "@/utils";
import { disputeOnHost } from "@test/fixtures/DisputeWindowWorkflowStaging";
import {
    addFreshSpectator,
    assertNewerStateAnswersOlderDispute,
    joinAsPendingParticipant,
    readLocalFinalizedHeight,
    readSnapshotHashAtKill,
    stageDepartedEligibleLeaver,
    suppressTimeoutChecks,
    waitForChainInboundHead
} from "@test/fixtures/OlderDisputeStaging";
import { readDisputeKill } from "@test/fixtures/OmittedInboundJoinerStaging";
import { MathTestSession as TestSession } from "@test/harness";
import { expect } from "chai";

describe("E2E: older dispute after sync to a newer finalized state", function () {
    it("E35: a fresh pending peer synced past the lagging chain anchor kills an older omitted-data dispute with the disputer's newer signed block from its retained evidence", async function () {
        const h = TestSession.getHarness();
        await h.scenario.preDisputeSetup({ transitionCount: 2 });
        const forkId = h.activeForkId!;
        const disputer = h.getPeer(0);

        // the chain anchor stays here while the channel moves on
        const anchor = await h.transition.postSnapshotWait();
        if (!anchor) throw new Error("No finalized snapshot to anchor");
        const fresh = await addFreshSpectator(h, {
            authoringPeerIndices: [0, 1, 2]
        });
        await suppressTimeoutChecks(h, [0, 1, 2, fresh]);
        await joinAsPendingParticipant(h, fresh, [0, 1, 2]);
        await waitForChainInboundHead(h, [0, 1, 2, fresh]);
        expect(await h.query.getOnChainSnapshotHash()).to.equal(anchor.hash);

        // the fresh peer trusts a final state above the anchor, holds the
        // disputer's signature on a newer block, and never held the
        // anchor's application state
        expect(
            (await readLocalFinalizedHeight(h, fresh, forkId)) ?? -1
        ).to.be.greaterThan(anchor.blockHeight);
        const newerSigned = await h
            .control(h.getPeer(fresh))
            .query.getLatestSignedBlockByParticipant(forkId, disputer.address)
            .request();
        expect(newerSigned?.height ?? -1).to.be.greaterThan(anchor.blockHeight);
        expect(newerSigned?.signatureRecoversToParticipant).to.equal(true);
        expect(
            await h
                .control(h.getPeer(fresh))
                .query.getStateMachineState(anchor.stateMachineStateHash)
                .request()
        ).to.equal(null);

        // every other auditor holds the same counter: only the fresh peer's kill may land
        await Promise.all(
            [0, 1, 2].map((peerIndex) =>
                h.rpcStub.suppressDisputeKill(peerIndex)
            )
        );

        // The pending peer never signed blocks before its join, so an
        // omitted-data dispute is admissible only when its last milestone
        // holds the chain anchor: the disputer claims the anchor state.
        const { encodedStateProof, encodedAuditingData } = await h
            .control(disputer)
            .dispute.buildOwnAuditingData(forkId, anchor.blockHeight)
            .request();
        const olderStateProof = Codec.decode(
            encodedStateProof,
            Type.StateProof
        );
        const olderAuditingData = Codec.decode(
            encodedAuditingData,
            Type.DisputeAuditingData
        );
        const { dispute } = await h.tamper.postTamperedDispute(
            disputer.index,
            (tampered, _confirmation, auditingData) => {
                tampered.input.stateProof = olderStateProof;
                tampered.input.latestStateSnapshotHash = StateSnapshot.from(
                    olderAuditingData.latestStateSnapshot
                ).hash;
                tampered.input.disputeAuditingDataHash = hash(
                    Codec.encode(olderAuditingData, Type.DisputeAuditingData)
                );
                tampered.postedAuditingData = false;
                if (auditingData)
                    Object.assign(auditingData, olderAuditingData);
            }
        );
        expect(
            await h.channelManager.isAuditingDataOmissionAllowed.staticCall(
                dispute
            )
        ).to.equal(true);

        await h.assert.storage.honestPeersStoredDisputeFraudProofWait({
            disputeFraudProofType: DisputeFraudProofType.DisputeNotLatestState,
            peerIndices: [fresh]
        });
        await h.event.waitForPeers("onDisputeKilled", [1, 2, fresh], 1, {
            mode: "atLeast"
        });
        await h.assert.dispute.slashedOnChainExactly([disputer.address]);
        // the fresh peer's counter is the one the chain applied
        const kill = await readDisputeKill(h, disputer.address);
        expect(kill.killer).to.equal(h.getPeer(fresh).address);
        expect(kill.appliedProofTypes).to.deep.equal([
            DisputeFraudProofType.DisputeNotLatestState
        ]);
        // the chain anchor still lagged when the kill landed
        expect(await readSnapshotHashAtKill(h, disputer.address)).to.equal(
            anchor.hash
        );
        // the counter needed no older application state
        expect(
            await h
                .control(h.getPeer(fresh))
                .query.getStateMachineState(anchor.stateMachineStateHash)
                .request()
        ).to.equal(null);

        await h.dispute.resolveDisputeWait({
            forkId,
            honestPeerIndices: [1, 2, fresh]
        });
    });

    it("E41: a second pending peer synced past a first pending peer's state answers that peer's older dispute with its own newer state and posted auditing data, and the reduction selects it", async function () {
        const h = TestSession.getHarness();
        await h.scenario.preDisputeSetup({ transitionCount: 2 });
        const forkId = h.activeForkId!;

        const first = await addFreshSpectator(h, {
            authoringPeerIndices: [0, 1, 2]
        });
        // the first stays at its synced state: blind to gossip, still connected
        await h.rpcStub.dropNetworkConfirmations(first);
        const second = await addFreshSpectator(h, {
            authoringPeerIndices: [0, 1, 2]
        });
        await suppressTimeoutChecks(h, [0, 1, 2, first, second]);
        await joinAsPendingParticipant(h, first, [0, 1, 2]);
        await joinAsPendingParticipant(h, second, [0, 1, 2]);
        await waitForChainInboundHead(h, [0, 1, 2, first, second]);
        // the participants hold every state: only the second pending peer
        // may answer with a newer one
        await h.dispute.suppressDisputeInitiation([0, 1, 2]);

        await assertNewerStateAnswersOlderDispute(h, {
            forkId,
            olderDisputerIndex: first,
            auditorIndex: second,
            observerIndex: 0,
            honestPeerIndices: [0, 1, 2],
            postOlderDispute: () => disputeOnHost(h, first, forkId)
        });
    });

    it("E43: a fresh pending auditor answers a departed but chain-eligible participant's older dispute with its own newer state and posted auditing data, and the reduction selects it", async function () {
        const h = TestSession.getHarness();
        const { forkId, alice, remaining, confirmExitParked, releaseExitPost } =
            await stageDepartedEligibleLeaver(h);
        // her parked exit post is released before the test ends
        try {
            const auditor = await addFreshSpectator(h, {
                authoringPeerIndices: remaining,
                isolateFromIndices: [alice.index]
            });
            await suppressTimeoutChecks(h, [auditor]);
            await joinAsPendingParticipant(h, auditor, remaining);
            await waitForChainInboundHead(h, [
                ...remaining,
                alice.index,
                auditor
            ]);
            // the participants hold every state: only the fresh auditor may
            // answer with a newer one
            await h.dispute.suppressDisputeInitiation(remaining);
            await confirmExitParked();

            await assertNewerStateAnswersOlderDispute(h, {
                forkId,
                olderDisputerIndex: alice.index,
                auditorIndex: auditor,
                observerIndex: remaining[0]!,
                honestPeerIndices: remaining,
                postOlderDispute: () => disputeOnHost(h, alice.index, forkId)
            });
        } finally {
            await releaseExitPost();
        }
    });
});
