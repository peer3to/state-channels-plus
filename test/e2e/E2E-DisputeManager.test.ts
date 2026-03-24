import { expect } from "chai";
import { DisputeFraudProofType, FraudProofType } from "@/types/sol-enums";
import { Codec, Type, hash, tryDecodeCustomError } from "@/utils";
import { TestSession, PeerTestHarness, DisputeTampering } from "@test/harness";

PeerTestHarness.setDefaultLogLevel("error");

/**
 * E2E Tests for Dispute Management
 *
 * Maps to: src/disputeManager/DisputeManager.ts
 *          src/stateManager/DisputeValidationService.ts
 *          src/stateManager/ValidationService.ts
 *          src/stateManager/validationStrategy/DisputeValidationStrategy.ts
 *
 * Tests dispute creation, validation, resolution, and fraud proof mechanisms.
 */
describe("E2E: Dispute Manager", function () {
    describe("Dispute Initiation", function () {
        it("should create dispute for invalid state transition", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 2);
            await h.byzantine.submitInvalidStateTransitionBlock(2);
            await h.assert.dispute.initiatedAndCommitedWait();
            await h.assert.storage.honestPeersStoredFraudProof({
                fraudProofType: FraudProofType.BlockInvalidStateTransition,
                maliciousPeerIndex: 2
            });
            await h.assert.storage.storedDisputeConfirmationsWait();
        });

        it("should dispute forged inbound message blocks", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 2);
            h.event.resetEventSpies();
            const nextPeer = await h.query.getNextPeerToWrite();
            await h.byzantine.submitForgedInboundMessageBlock(nextPeer.index);
            await h.assert.dispute.initiatedAndCommitedWait();
            await h.assert.storage.honestPeersStoredFraudProof({
                fraudProofType: FraudProofType.ForgedInboundMessageBlock,
                maliciousPeerIndex: nextPeer.index
            });
            await h.assert.storage.storedDisputeConfirmationsWait();
        });
    });

    describe("Dispute Resolution and Fork Management", function () {
        it("should reduce invalid state transition disputes and create new fork", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup(4);
            const nextPeer = await h.query.getNextPeerToWrite();
            await h.byzantine.submitInvalidStateTransitionBlock(nextPeer.index);
            await h.assert.dispute.initiatedAndCommitedWait();
            await h.dispute.resolveDisputeWait({
                maliciousPeerIndex: nextPeer.index,
                forkSettleTimeoutMs: 15000
            });
        });

        it("should post updated state snapshot after fork resolution", async function () {
            const h = TestSession.getHarness();
            await h.scenario.fourPeersDisputeResolutionAndSnapshotUpdateDetached();

            await h.transition.fromHonestPeersOnly((c) => c.add(1));
            await h.transition.fromHonestPeersOnly((c) => c.leaveChannel());
            await h.transition.fromHonestPeersOnly((c) => c.add(3));

            await h.assert.sync.onlyHonestPeersInSync();
            await await h.assert.sync.onChainSnapshotAndPeersSameForkWait(); // await this to be sure that the post snapshot event bellow is not triggered by the detached update from above
            h.event.resetEventSpies();
            const expectedSnapshot2 = await h.transition.postSnapshot({
                peerIndex: 0
            });

            await h.assert.snapshot.onChainSnapshotChangedDetached({
                expectedSnapshot: expectedSnapshot2
            });
            return;
        });
    });

    describe("Fraud Proof Detection", function () {
        // FLAKY
        it("should kill a spam dispute with no legitimate enforcement basis", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup();
            h.contextApi.markMaliciousPeer({ maliciousPeerIndex: 1 });

            // Post a dispute from peer 1 that is internally valid but has no legitimate
            // enforcement basis: no timeout, no on-chain slashes, no self-removal.
            await h.tamper.postTamperedDispute(1, (dispute) => {
                dispute.input.timeout.participant =
                    "0x0000000000000000000000000000000000000000";
                dispute.input.onChainSlashes = [];
                dispute.input.selfRemoval = false;
            });

            await h.event.waitForAllPeers("onDisputeKilled", 1, {
                mode: "atLeast"
            });

            await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
                disputeFraudProofType:
                    DisputeFraudProofType.InvalidDisputeReason
            });

            await h.dispute.resolveDisputeWait({
                maliciousPeerIndex: 1
            });
        });

        it.only("a dispute submitted with no calldata should not be killed even if the auditing data hash is tampered", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup();

            h.tamper.stubConstructDispute(
                0,
                DisputeTampering.tamperAuditingDataHash,
                {
                    autoRestore: true
                }
            );

            // Peer 1 double-signs
            await h.byzantine.submitDoubleSignBlock(1);

            await h.assert.dispute.initiatedAndCommitedWait();

            h.assert.storage.honestPeersStoredFraudProof({
                fraudProofType: FraudProofType.BlockDoubleSign,
                maliciousPeerIndex: 1
            });

            await h.dispute.resolveDisputeWait({
                maliciousPeerIndex: 1
            });

            // Peer 1 (double-signer) removed.
            await h.assert.sync.maliciousPeerExcluded();
            // peer 0 (tampered hash) and peer 2 remain
            await h.assert.sync.participantCount({ expectedCount: 2 });
        });

        it("should reject dispute submission when posted auditing data hash does not match submitted auditing data", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup();

            try {
                await h.tamper.postTamperedDispute(1, (dispute) => {
                    dispute.postedAuditingData = true;
                    dispute.input.disputeAuditingDataHash = hash("0x42");
                });
                expect.fail(
                    "Expected ErrorAuditingDataHashMismatch to be thrown"
                );
            } catch (error: any) {
                const customError = tryDecodeCustomError(error);
                expect(customError).to.not.be.null;
                expect(customError!.errorDescription.name).to.equal(
                    "ErrorAuditingDataHashMismatch"
                );
            }
        });

        it("should reject timeout dispute when timedout participant is not next to write", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup();
            await h.byzantine.postTamperedDisputeTimeout({
                submitterIndex: 0,
                wrongParticipantIndex: 1,
                blockHeight: 2
            });
            await h.event.waitForAllPeers("onDisputeKilled", 1, {
                mode: "atLeast"
            });
            await h.assert.storage.honestPeersStoredDisputeFraudProofDetached();
            await h.dispute.resolveDisputeWait({
                maliciousPeerIndex: 0
            });
            await h.assert.sync.forkChangedWait();
        });

        it("should reject dispute when auditing data is partial and state proof invalid", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup();
            await h.byzantine.tamperedDisputePartialAuditing(1);
            await h.event.waitForAllPeers("onDisputeKilled", 1, {
                mode: "atLeast"
            });
            await h.assert.storage.honestPeersStoredDisputeFraudProofDetached();
            await h.dispute.resolveDisputeWait({
                maliciousPeerIndex: 1
            });
            await h.assert.sync.forkChangedWait();
        });

        it("should reject dispute when full auditing data reconstructed but both commitment and state proof are invalid", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup();
            await h.byzantine.tamperedDisputeDoubleFault(1);
            await h.event.waitForAllPeers("onDisputeKilled", 1, {
                mode: "atLeast"
            });
            await h.assert.storage.honestPeersStoredDisputeFraudProofDetached();
            await h.dispute.resolveDisputeWait({
                maliciousPeerIndex: 1
            });
            await h.assert.sync.forkChangedWait();
        });

        it("should reject dispute when auditing data commitment is valid but state proof is invalid without calldata", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup();
            await h.byzantine.tamperedDisputeInvalidStateProof(1);
            await h.event.waitForAllPeers("onDisputeKilled", 1, {
                mode: "atLeast"
            });
            await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
                disputeFraudProofType:
                    DisputeFraudProofType.DisputeInvalidStateProof
            });
            await h.dispute.resolveDisputeWait({
                maliciousPeerIndex: 1
            });
            await h.assert.sync.forkChangedWait();
        });

        it("should reject dispute when auditing data commitment is valid but state proof is invalid with calldata", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup();
            await h.byzantine.tamperedDisputeInvalidStateProofWithCalldata(1);
            await h.event.waitForAllPeers("onDisputeKilled", 1, {
                mode: "atLeast"
            });
            await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
                disputeFraudProofType:
                    DisputeFraudProofType.DisputeInvalidStateProof
            });
            await h.dispute.resolveDisputeWait({
                maliciousPeerIndex: 1
            });
            await h.assert.sync.forkChangedWait();
        });
    });

    describe("Re-Dispute Detection", function () {
        it("should kill a tampered state proof that corrupts a signed block", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup(4);
            await h.byzantine.disconnect(3);
            await h.transition.advanceState({ waitForPeers: [0, 1, 2] });
            h.event.resetEventSpies();

            h.byzantine.stubDisputeConstruction({
                peerIndex: 0,
                tamperFn: async (dispute) => {
                    const stateProof = dispute.input.stateProof;

                    const localDiamond = h.getLocalDiamond(0);
                    const [hasBlock, latestBlock] =
                        await localDiamond.getLatestBlockFromStateProof(
                            stateProof
                        );
                    if (!hasBlock) {
                        throw new Error(
                            "State proof does not contain a block to tamper with"
                        );
                    }

                    latestBlock.transaction.header.transactionCnt =
                        BigInt(latestBlock.transaction.header.transactionCnt) +
                        5n;

                    stateProof.milestones
                        .at(-1)!
                        .blockConfirmations.at(-1)!.signedBlock.encodedBlock =
                        Codec.encode(latestBlock, Type.Block);
                }
            });

            await h.byzantine.submitInvalidStateTransitionBlock(1);
            await h.assert.dispute.initiatedAndCommitedWait({
                peersIndices: [0, 2]
            }); // both 0 and 2 should commit
            await h.assert.storage.honestPeersStoredFraudProof({
                fraudProofType: FraudProofType.BlockInvalidStateTransition,
                maliciousPeerIndex: 1,
                peerIndices: [0, 2] // peer 3 is disconnected, so it doesn't observe the invalid block
            }); // both 0 and 2 should store fraud proof - 0 becomes malicous later
            await h.event.waitForAllPeers("onDisputeKilled", 1, {
                mode: "atLeast"
            }); // dispute from peer 0 should be killed
            await h.assert.storage.honestPeersStoredDisputeFraudProofDetached(); // peer 2 should store it
            await h.dispute.resolveDisputeWait({
                maliciousPeerIndex: 1,
                honestPeerIndices: [2, 3]
            });
            // h.byzantine.restoreDisputeConstruction(0); // does this make a difference?
        });
    });

    describe("Partial Syncing via Dispute Validation", function () {
        it("should have missing state Storage when peer receives dispute with blocks it doesn't have", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 1);
            await h.assert.sync.peersInSyncWait();
            h.event.resetEventSpies();
            h.byzantine.stubBroadcast(1);
            await h.transition.advanceState({ waitForSync: false });

            await h.assert.sync.peerBlockHeightGreaterThan(1, 2);
            await h.assert.sync.blockHeight({
                expectedHeight: 0,
                peerIndices: [0, 2]
            });
            await h.assert.sync.blockHeight({
                expectedHeight: 1,
                peerIndices: [1]
            });
            const forkId = h.activeForkId;
            await h.byzantine.submitInvalidStateTransitionBlock(0);

            await h.event.waitForPeers("onDisputeCommitted", [1, 2], 2, {
                mode: "atLeast"
            });

            // Height should remain, the same, but block and state should be in storage
            await h.assert.sync.blockHeight({
                expectedHeight: 0,
                peerIndices: [0, 2]
            });
            await h.assert.storage.honestPeersStoredBlockAndStateWait({
                height: 1
            });
            if (forkId != h.activeForkId) {
                throw new Error("ForkId not the same after sync");
            }
        });

        it("should handle valid dispute when validating peer is missing snapshot data", async function () {
            // TODO
            // This is NOT a good test, since peer 2 will try and timeout peer 0 and while doing so will fetch on-chain block (and run it through the pipeline) while checking race condition (calldata posted)
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 0);
            h.byzantine.stubCalldataHandler(2);
            h.contextApi.storeSnapshotCount(2, "before_isolation");
            await h.byzantine.disconnect(2);
            h.event.resetEventSpies();

            await h.transition.advanceState({ waitForPeers: [0, 1], count: 2 });
            await h.event.waitForDisputeFromAnyPeer([0, 1]);
            await h.assert.snapshot.snapshotCountIncreasedSince(
                2,
                "before_isolation"
            );
            await h.assert.storage.honestPeersStoredBlockAndStateWait({
                height: 1
            });
            h.byzantine.restoreCalldataHandler(2);
        });
    });
});
