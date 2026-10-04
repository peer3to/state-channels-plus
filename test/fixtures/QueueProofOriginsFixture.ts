// @spec-test-coverage-ignore: shared fixture triggers production behavior; executable evidence belongs to its calling test declarations
import { Block } from "@/models";
import { SourceEligibility } from "@/stateManager/membership/MembershipService";
import { BlockOrigin } from "@/storage/QueueStorage";
import { Codec, Type } from "@/utils";
import { MathTestSession } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";

type ReplayedEntry = {
    hash: string;
    origin: BlockOrigin;
    sources: number;
    participants: string[];
};

export async function assertHistoricalProofAfterSlash() {
    const h = MathTestSession.getHarness();
    await h.scenario.preDisputeSetupDisconnectedPeer();
    const forkId = h.activeForkId!;
    // Peer 2 was offline for the disputed blocks, so its own audit replays
    // them. An auditor that holds a tail block fast-forwards over it.
    const auditor = h.getPeer(2);
    for (const peer of h.peers)
        await h.control(peer).stub.stubHoldReductionTasks().request();
    await h.execOnHost(auditor, (sm) => {
        const ingest = sm.blockIngestService;
        const original = ingest.onBlockConfirmation;
        const replayed: ReplayedEntry[] = [];
        Object.assign(sm, { replayObservation: { original, replayed } });
        ingest.onBlockConfirmation = async (entry, options) => {
            const seen = {
                hash: String(entry.block.hash),
                origin: entry.origin,
                sources: entry.sourcesToSignatures.size
            };
            const isOk = await original.call(ingest, entry, options);
            // only dispute replay judges a block from a predecessor
            if (entry.predecessor)
                replayed.push({
                    ...seen,
                    participants: sm.storage
                        .getParticipantsUnionFromSnapshots(
                            entry.predecessor.snapshot,
                            sm.storage.stateSnapshots.getStateSnapshotByHash(
                                entry.block.stateSnapshotHash
                            )
                        )
                        .map(String)
                });
            return isOk;
        };
    });
    try {
        await h.byzantine.submitDoubleSignBlock(1);
        await h.assert.dispute.initiatedAndCommitedWait({
            peersIndices: [0, 3],
            expectedCount: 2,
            // peer 2 never signs, so no block is final by everyone
            initiatedWithAuditingData: true
        });
        expect(await h.query.onChainSlashedParticipants()).to.include(
            h.getPeer(1).address
        );
        const { dispute, auditingData } =
            await h.dispute.fetchConstructedDispute(3, forkId);
        // no threshold point yet: one unfinal run from block 0, all replayed
        expect(dispute.input.stateProof.milestones).to.have.length(1);
        const tailHashes =
            dispute.input.stateProof.milestones[0].blockConfirmations.map(
                (confirmation) =>
                    String(Block.fromBlockConfirmation(confirmation).hash)
            );
        let replayed: ReplayedEntry[] = [];
        await waitFor(async () => {
            replayed = await h.execOnHost(
                auditor,
                (sm) =>
                    (
                        sm as unknown as {
                            replayObservation: { replayed: ReplayedEntry[] };
                        }
                    ).replayObservation.replayed
            );
            return tailHashes.every((hash) =>
                replayed.some((entry) => entry.hash === hash)
            );
        });
        for (const entry of replayed.filter((entry) =>
            tailHashes.includes(entry.hash)
        )) {
            expect(entry.origin).to.equal(BlockOrigin.PROOF);
            expect(entry.sources).to.equal(0);
            expect(entry.participants).to.have.members(
                h.peers.map((peer) => peer.address)
            );
        }
        // an auditor holding the tail audits it in full without replay
        const result = await h.execOnHost(
            h.getPeer(0),
            async (sm, args) => {
                const blacklistBefore = args.honest.map((address) =>
                    sm.p2pManager.isBlacklisted(address)
                );
                const run =
                    await sm.p2pManager.localRpc.dispute.runDisputeValidation(
                        args.encodedDispute,
                        { encodedAuditingData: args.encodedAuditingData }
                    );
                return {
                    run,
                    blacklistBefore,
                    blacklistAfter: args.honest.map((address) =>
                        sm.p2pManager.isBlacklisted(address)
                    ),
                    eligibility:
                        sm.membershipService.getCachedSourceEligibility(
                            args.slashed
                        )
                };
            },
            {
                encodedDispute: String(Codec.encode(dispute, Type.Dispute)),
                encodedAuditingData: String(
                    Codec.encode(auditingData, Type.DisputeAuditingData)
                ),
                slashed: h.getPeer(1).address,
                honest: [h.getPeer(0).address, h.getPeer(3).address]
            }
        );
        expect(result.run.outcome).to.equal("returned");
        expect(result.run.storedProof).to.equal(undefined);
        expect(result.eligibility).to.equal(SourceEligibility.SLASHED);
        expect(result.blacklistAfter).to.deep.equal(result.blacklistBefore);
    } finally {
        await h.execOnHost(auditor, (sm) => {
            sm.blockIngestService.onBlockConfirmation = (
                sm as unknown as {
                    replayObservation: {
                        original: typeof sm.blockIngestService.onBlockConfirmation;
                    };
                }
            ).replayObservation.original;
        });
        for (const peer of h.peers)
            await h.control(peer).stub.restoreReductionTasks(true).request();
    }
    await h.dispute.resolveDisputeWait({ forkId });
}
