// @spec-test-coverage-ignore: shared fixture triggers production behavior; executable evidence belongs to its calling test declarations
import { Block } from "@/models";
import { SourceEligibility } from "@/stateManager/membership/MembershipService";
import { BlockOrigin } from "@/storage/QueueStorage";
import { DisputeFraudProofType } from "@/types/sol-enums";
import { Codec, Type } from "@/utils";
import { hexString } from "@test/factory";
import { MathTestSession } from "@test/harness";
import { expect } from "chai";

export async function assertHistoricalProofAfterSlash() {
    const h = MathTestSession.getHarness();
    await h.scenario.preDisputeSetupDisconnectedPeer();
    const forkId = h.activeForkId!;
    for (const peer of h.peers)
        await h.control(peer).stub.stubHoldReductionTasks().request();
    try {
        await h.byzantine.submitDoubleSignBlock(1);
        await h.assert.dispute.initiatedAndCommitedWait({
            peersIndices: [0, 3],
            expectedCount: 2,
            initiatedWithAuditingData: false
        });
        expect(await h.query.onChainSlashedParticipants()).to.include(
            h.getPeer(1).address
        );
        const { dispute, auditingData } =
            await h.dispute.fetchConstructedDispute(3, forkId);
        expect(dispute.input.stateProof.signedBlocks.length).to.be.greaterThan(
            0
        );
        const result = await h.execOnHost(
            h.getPeer(0),
            async (sm, args) => {
                const ingest = sm.blockIngestService;
                const original = ingest.onBlockConfirmation.bind(ingest);
                const entries: {
                    hash: string;
                    origin: BlockOrigin;
                    sources: number;
                    participants: string[];
                }[] = [];
                // Observe replay; calldata may reach the queue concurrently.
                ingest.onBlockConfirmation = (entry, options) => {
                    if (
                        options?.validationStrategy
                            ?.enforcesLiveForkAndOrderingGates === false
                    )
                        entries.push({
                            hash: String(entry.block.hash),
                            origin: entry.origin,
                            sources: entry.sourcesToSignatures.size,
                            participants: sm.storage
                                .getParticipantsUnion(
                                    entry.block.coordinates,
                                    entry.block.stateSnapshotHash
                                )
                                .map(String)
                        });
                    return original(entry, options);
                };
                const blacklistBefore = args.honest.map((address) =>
                    sm.p2pManager.isBlacklisted(address)
                );
                try {
                    const run =
                        await sm.p2pManager.localRpc.dispute.runDisputeValidation(
                            args.encodedDispute,
                            { encodedAuditingData: args.encodedAuditingData }
                        );
                    return {
                        run,
                        entries,
                        blacklistBefore,
                        blacklistAfter: args.honest.map((address) =>
                            sm.p2pManager.isBlacklisted(address)
                        ),
                        eligibility:
                            sm.membershipService.getCachedSourceEligibility(
                                args.slashed
                            )
                    };
                } finally {
                    ingest.onBlockConfirmation = original;
                }
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
        // Concurrent audits may replay the same blocks during this observation.
        expect([
            ...new Set(result.entries.map((entry) => entry.hash))
        ]).to.have.members(
            dispute.input.stateProof.signedBlocks.map((signedBlock) =>
                String(Block.fromSignedBlock(signedBlock).hash)
            )
        );
        for (const entry of result.entries) {
            expect(entry.origin).to.equal(BlockOrigin.PROOF);
            expect(entry.sources).to.equal(0);
            expect(entry.participants).to.have.members(
                h.peers.map((peer) => peer.address)
            );
        }
        expect(result.eligibility).to.equal(SourceEligibility.SLASHED);
        expect(result.blacklistAfter).to.deep.equal(result.blacklistBefore);
    } finally {
        for (const peer of h.peers)
            await h.control(peer).stub.restoreReductionTasks(true).request();
    }
    await h.dispute.resolveDisputeWait({ forkId });
}

export async function assertMalformedRequiredProofRejected() {
    const h = MathTestSession.getHarness();
    await h.scenario.preDisputeSetupCalldataPath();
    const forkId = h.activeForkId!;
    await h.tamper.stubConstructDispute(
        3,
        (dispute, _sm, args) => {
            dispute.input.stateProof.milestones
                .at(-1)!
                .blockConfirmations.at(-1)!.signedBlock.encodedBlock = String(
                args.encodedMalformedBlock
            );
        },
        { autoRestore: true, args: { encodedMalformedBlock: hexString(128) } }
    );
    await h.byzantine.submitDoubleSignBlock(1);
    await h.assert.dispute.initiatedWait({
        peersIndices: [3],
        initiatedWithAuditingData: true
    });
    await h.event.waitForPeers("onDisputeKilled", [0], 1, { mode: "atLeast" });
    await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
        disputeFraudProofType: DisputeFraudProofType.DisputeInvalidStateProof
    });
    await h.dispute.resolveDisputeWait({
        forkId,
        syntheticOnChainParticipants: 1
    });
}
