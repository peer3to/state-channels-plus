import { DisputeFraudProofType } from "@/types/sol-enums";
import { Codec, Type } from "@/utils";
import {
    commitmentOf,
    committedDisputeLogs,
    lastMilestoneFirstBlock,
    latestProofBlock,
    storedStateHashAt
} from "@test/fixtures/DisputeWindowWorkflowStaging";
import { stageMissingParticipantSignature } from "@test/fixtures/LateSignatureStaging";
import {
    postJoinerBypassDispute,
    readDisputeKill,
    stageSeatedJoinerHistory
} from "@test/fixtures/OmittedInboundJoinerStaging";
import {
    peerBlockHeights,
    PRUNING_ON,
    stagePrunedChannelPastAnchor
} from "@test/fixtures/PruningStaging";
import { disputeOnHost } from "@test/fixtures/ReplayGasLimitStaging";
import { storedProofView } from "@test/fixtures/StoredProofStaging";
import { MathTestSession as TestSession } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";

/**
 * History pruning on (`PRUNE_HISTORY`): each peer deletes the history below
 * the chain anchor and the history its proven final hop skips. The stored
 * proof still serves synchronization, a dispute audit still judges honest
 * and side-chain disputes, and the reduction still finds its data.
 */
describe("E2E: history pruning", function () {
    it("past several final points and a chain anchor advance, every participant keeps only the anchor block below its final point, and a new spectator syncs from the pruned peers and follows the channel", async function () {
        const h = TestSession.getHarness();
        const { forkId, anchor } = await stagePrunedChannelPastAnchor(h, {
            peerCount: 3,
            blocksBefore: 3,
            blocksAfter: 3,
            timeConfig: {
                p2pTime: 5,
                agreementTime: 4,
                chainFallbackTime: 2,
                evidenceTime: 4
            }
        });
        for (const peer of h.peers) {
            const stored = (await storedProofView(h, peer.index, forkId))!;
            const heights = await peerBlockHeights(h, peer.index, forkId);
            expect(stored.anchor.hash).to.equal(String(anchor.hash));
            expect(
                heights.filter((height) => height < stored.finalized.height),
                `peer ${peer.index} keeps only the anchor block below its final point`
            ).to.deep.equal([stored.anchor.height]);
        }

        const { peer: spectator } = await h.join.addSpectatorAuthoring({
            authoringPeerIndices: [0, 1, 2],
            minimumBlocks: 2,
            maximumBlocks: 18
        });
        await h.assert.sync.peersInSyncWait();

        const synced = (await storedProofView(h, spectator.index, forkId))!;
        expect(synced.isStateHeld, "the spectator's final state").to.equal(
            true
        );
        expect(synced.finalized.height).to.be.greaterThan(0);
    });

    it("past several final points and a chain anchor advance, honest peers dispute an invalid transition: no auditor stores a counter, the dispute reduces to the next fork and every honest peer follows it", async function () {
        const h = TestSession.getHarness();
        await stagePrunedChannelPastAnchor(h, {
            peerCount: 4,
            blocksBefore: 3,
            blocksAfter: 2
        });
        const maliciousPeerIndex = (await h.query.getNextPeerToWrite()).index;

        const { newForkId, honestPeerIndices } =
            await h.scenario.disputeWithReduction({ maliciousPeerIndex });
        await h.assert.snapshot.localSnapshotsChangedWait({
            expectedForkId: newForkId as string
        });

        for (const peerIndex of honestPeerIndices) {
            const peer = h.getPeer(peerIndex);
            expect(
                await h
                    .control(peer)
                    .query.getDisputeFraudProofTypes()
                    .request(),
                `peer ${peerIndex}'s counters`
            ).to.deep.equal([]);
            expect(
                String((await h.query.getLocalStateSnapshot(peer)).forkID),
                `peer ${peerIndex} follows the reduced fork`
            ).to.equal(String(newForkId));
        }
    });

    it("pruning on, the colluders' dispute that hops from the chain anchor above seated Charlie's final point without his JOIN is still killed by Charlie's DisputeFinalPointRegression, and exactly Alice and Bob are slashed", async function () {
        const h = TestSession.getHarness();
        const history = await stageSeatedJoinerHistory(h, {
            configOverrides: PRUNING_ON
        });
        const charlie = h.getPeer(history.charlieIndex);
        const stored = (await storedProofView(
            h,
            charlie.index,
            history.forkId
        ))!;
        const heights = await peerBlockHeights(
            h,
            charlie.index,
            history.forkId
        );
        expect(
            heights.filter((height) => height < stored.finalized.height),
            "Charlie keeps only the anchor block below his final point"
        ).to.deep.equal([stored.anchor.height]);

        const posted = await postJoinerBypassDispute(h, history);
        expect(posted.hopBlock.height).to.be.greaterThan(
            history.charlieFinal.blockHeight
        );

        await h.assert.storage.honestPeersStoredDisputeFraudProofWait({
            disputeFraudProofType:
                DisputeFraudProofType.DisputeFinalPointRegression,
            peerIndices: [charlie.index]
        });
        await h.event.waitForPeers("onDisputeKilled", [charlie.index], 1, {
            mode: "atLeast"
        });
        const kill = await readDisputeKill(
            h,
            h.getPeer(history.aliceIndex).address
        );
        expect(kill.killer).to.equal(charlie.address);
        expect(kill.appliedProofTypes).to.deep.equal([
            DisputeFraudProofType.DisputeFinalPointRegression
        ]);
        await h.assert.dispute.slashedOnChainExactly([
            h.getPeer(history.aliceIndex).address,
            h.getPeer(history.bobIndex).address
        ]);
    });

    it("pruning on, an auditor whose state at the disputer's final point is pruned (its own final point and latest state are later) does not judge that proof, stores no counter, sends no kill, and its own dispute upload lands on chain", async function () {
        const h = TestSession.getHarness();
        const { forkId, writer, silenced, height } =
            await stageMissingParticipantSignature(h, {
                configOverrides: PRUNING_ON
            });
        // the silenced peer holds every signature on the writer's block, so
        // that block is its final point; the writer lacks one and stays below
        await waitFor(
            async () =>
                (await storedProofView(h, silenced.index, forkId))?.finalized
                    .height === height,
            h.event.protocolEventTimeoutMs()
        );
        const writerFinal = (await storedProofView(h, writer.index, forkId))!
            .finalized;
        expect(writerFinal.height).to.be.lessThan(height);
        const baseStateHash = await storedStateHashAt(
            h,
            writer.index,
            forkId,
            writerFinal.height
        );
        expect(
            await h
                .control(silenced)
                .query.getStateMachineState(baseStateHash)
                .request(),
            "the auditor pruned the state at the writer's final point"
        ).to.equal(null);
        // the writer goes offline; the others author a block it never sees,
        // so the auditor's latest state is above the writer's
        await h.network.blacklistAndDisconnectPeer(writer.index);
        const online = h.peers
            .map((peer) => peer.index)
            .filter((index) => index !== writer.index);
        await h.transition.advanceState({
            count: 1,
            waitForPeers: online,
            waitForFinalization: false
        });
        const writerUploads = await h.rpcStub.recordDisputeSubmissions(
            writer.index,
            { forward: true }
        );
        const auditorUploads = await h.rpcStub.recordDisputeSubmissions(
            silenced.index,
            { forward: true }
        );
        const kills = await h.rpcStub.recordDisputeFraudProofApplies(
            silenced.index
        );

        await h.control(writer).dispute.setForceExit(true).request();
        await disputeOnHost(h, writer.index, forkId);
        const opening = Codec.decode(
            (await writerUploads.submissions())[0].encodedDispute,
            Type.Dispute
        );
        // premise - omitted auditing data: no posted state stands in for the base
        expect(opening.postedAuditingData).to.equal(false);
        expect(lastMilestoneFirstBlock(opening).height).to.equal(
            writerFinal.height
        );
        await waitFor(
            async () => (await auditorUploads.submissions()).length > 0,
            h.event.protocolEventTimeoutMs()
        );
        const own = Codec.decode(
            (await auditorUploads.submissions())[0].encodedDispute,
            Type.Dispute
        );
        await waitFor(
            async () =>
                (await committedDisputeLogs(h)).some(
                    ({ commitment }) => commitment === commitmentOf(own)
                ),
            h.event.protocolEventTimeoutMs()
        );

        expect(
            String(own.input.disputer),
            "the auditor's own dispute"
        ).to.equal(silenced.address);
        expect(lastMilestoneFirstBlock(own).height).to.equal(height);
        expect(latestProofBlock(own).height).to.equal(height + 1);
        expect(
            await h
                .control(silenced)
                .query.hasDisputeConfirmation(commitmentOf(opening))
                .request(),
            "the writer's dispute is stored as audited"
        ).to.equal(true);
        expect(
            await h
                .control(silenced)
                .query.getDisputeFraudProofTypes()
                .request()
        ).to.deep.equal([]);
        expect(await kills.applies()).to.deep.equal([]);
    });
});
