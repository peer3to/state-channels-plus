import { expect } from "chai";
import { FraudProofType } from "@/types/sol-enums";
import { MathTestSession as TestSession } from "@test/harness";
import { covers } from "./domain";

describe("block-confirmation / blockFraudProofs", function () {
    it(
        "double sign → BlockDoubleSign",
        covers(
            {
                proofType: "BlockDoubleSign",
                strategy: "block-validation",
                hook: "doubleSignDetected",
                transaction: "double-signed"
            },
            async function () {
                const h = TestSession.getHarness();
                await h.lifecycle.start(3, 2);
                const maliciousPeerIndex = 1;
                await h.byzantine.submitDoubleSignBlock(maliciousPeerIndex);

                await h.assert.dispute.initiatedAndCommitedWait();
                h.assert.storage.honestPeersStoredFraudProof({
                    fraudProofType: FraudProofType.BlockDoubleSign,
                    maliciousPeerIndex
                });

                await h.dispute.resolveDisputeWait();
                await h.assert.sync.onlyHonestPeersInSync();
            }
        )
    );

    it(
        "wrong genesis → WrongGenesis",
        covers(
            {
                proofType: "WrongGenesis",
                previousState: "genesis-snapshot",
                strategy: "block-validation",
                hook: "wrongGenesisDetected",
                previousBlockHash: "wrong-genesis"
            },
            async function () {
                const h = TestSession.getHarness();
                await h.lifecycle.start(3, 2);

                // Peer 2 submits a competing block at height 0 with a wrong previousBlockHash.
                const maliciousPeerIndex = 2;
                await h.byzantine.submitWrongGenesisBlock(maliciousPeerIndex);

                await h.assert.dispute.initiatedAndCommitedWait();
                h.assert.storage.honestPeersStoredFraudProof({
                    fraudProofType: FraudProofType.WrongGenesis,
                    maliciousPeerIndex
                });

                await h.dispute.resolveDisputeWait();
                await h.assert.sync.onlyHonestPeersInSync();
            }
        )
    );

    it(
        "unexpected next leader → BlockInvalidStateTransition",
        covers(
            {
                proofType: "BlockInvalidStateTransition",
                strategy: "block-validation",
                hook: "invalidStateTransitionDetected",
                participant: "wrong-leader"
            },
            async function () {
                const h = TestSession.getHarness();
                await h.lifecycle.start(3, 3);

                const maliciousPeerIndex = 1; // NOT the expected next leader
                await h.byzantine.submitUnexpectedNextLeaderBlock(
                    maliciousPeerIndex
                );

                await h.assert.dispute.initiatedAndCommitedWait();
                h.assert.storage.honestPeersStoredFraudProof({
                    fraudProofType: FraudProofType.BlockInvalidStateTransition,
                    maliciousPeerIndex
                });

                await h.dispute.resolveDisputeWait();
                await h.assert.sync.onlyHonestPeersInSync();
            }
        )
    );

    it(
        "invalid timestamp → InvalidTimestamp",
        covers(
            {
                proofType: "InvalidTimestamp",
                timestamp: "out-of-range"
            },
            async function () {
                const h = TestSession.getHarness();
                await h.lifecycle.start(3, 2);

                // Peer 2 submits a block with a timestamp before the previous block's
                // timestamp → objectiveInvalidTimestampDetected → InvalidTimestamp.
                const maliciousPeerIndex = 2;
                await h.byzantine.submitInvalidTimestampBlock(
                    maliciousPeerIndex
                );

                await h.assert.dispute.initiatedAndCommitedWait();
                h.assert.storage.honestPeersStoredFraudProof({
                    fraudProofType: FraudProofType.InvalidTimestamp,
                    maliciousPeerIndex
                });

                await h.dispute.resolveDisputeWait();
                await h.assert.sync.onlyHonestPeersInSync();
            }
        )
    );

    it(
        "broken inbound chain → BlockInvalidStateTransition",
        covers(
            {
                proofType: "BlockInvalidStateTransition",
                strategy: "block-validation",
                hook: "invalidStateTransitionDetected",
                messageBlocks: "broken-chain"
            },
            async function () {
                const h = TestSession.getHarness();
                await h.lifecycle.start(3, 2);

                // Peer 2 submits a block that includes a messageBlock whose
                // previousBlockHash does not chain from the stored inbound state
                // → findBrokenInboundMessageChainBlock fires after validateBlockConfirmation
                // succeeds → invalidStateTransitionDetected → BlockInvalidStateTransition.
                const maliciousPeerIndex = 2;
                await h.byzantine.submitBrokenInboundChainBlock(
                    maliciousPeerIndex
                );

                await h.assert.dispute.initiatedAndCommitedWait();
                h.assert.storage.honestPeersStoredFraudProof({
                    fraudProofType: FraudProofType.BlockInvalidStateTransition,
                    maliciousPeerIndex
                });

                await h.dispute.resolveDisputeWait();
                await h.assert.sync.onlyHonestPeersInSync();
            }
        )
    );

    it(
        "forged inbound message → ForgedInboundMessageBlock",
        covers(
            {
                proofType: "ForgedInboundMessageBlock",
                strategy: "block-validation",
                hook: "forgedInboundMessageBlockDetected",
                messageBlocks: "forged-inbound"
            },
            async function () {
                const h = TestSession.getHarness();
                await h.lifecycle.start(3, 2);

                // Peer 2 submits a block that contains a fabricated inbound message
                // block that was never actually sent by any peer
                // → detectForgedInboundMessageBlock fires → forgedInboundMessageBlockDetected
                // → ForgedInboundMessageBlock.
                const maliciousPeerIndex = 2;
                await h.byzantine.submitForgedInboundMessageBlock(
                    maliciousPeerIndex
                );

                await h.assert.dispute.initiatedAndCommitedWait();
                h.assert.storage.honestPeersStoredFraudProof({
                    fraudProofType: FraudProofType.ForgedInboundMessageBlock,
                    maliciousPeerIndex
                });

                await h.dispute.resolveDisputeWait();
                await h.assert.sync.onlyHonestPeersInSync();
            }
        )
    );

    it(
        "applyTransaction failure → BlockInvalidStateTransition",
        covers(
            {
                proofType: "BlockInvalidStateTransition",
                strategy: "block-validation",
                hook: "invalidStateTransitionDetected",
                transaction: "apply-fails"
            },
            async function () {
                const h = TestSession.getHarness();
                await h.lifecycle.start(3, 2);

                // Peer 2 submits a block whose transaction body is malformed data that
                // the contract rejects; applyTransaction returns success=false
                // → invalidStateTransitionDetected → BlockInvalidStateTransition.
                const maliciousPeerIndex = 2;
                await h.byzantine.submitInvalidTransactionDataBlock(
                    maliciousPeerIndex
                );

                await h.assert.dispute.initiatedAndCommitedWait();
                h.assert.storage.honestPeersStoredFraudProof({
                    fraudProofType: FraudProofType.BlockInvalidStateTransition,
                    maliciousPeerIndex
                });

                await h.dispute.resolveDisputeWait();
                await h.assert.sync.onlyHonestPeersInSync();
            }
        )
    );

    it(
        "stateSnapshotHash mismatch → BlockInvalidStateTransition",
        covers(
            {
                proofType: "BlockInvalidStateTransition",
                strategy: "block-validation",
                hook: "invalidStateTransitionDetected",
                stateSnapshotHash: "mismatch"
            },
            async function () {
                const h = TestSession.getHarness();
                await h.lifecycle.start(3, 2);

                // Peer 2 submits a block with a valid transaction but a wrong
                // stateSnapshotHash (ZeroHash).
                const maliciousPeerIndex = 2;
                const honestPeers = h.peers.filter(
                    (p) => p.index !== maliciousPeerIndex
                );
                const honestSumsBefore = await Promise.all(
                    honestPeers.map((p) => p.contractInstance.getSum())
                );
                await h.byzantine.submitInvalidStateTransitionBlock(
                    maliciousPeerIndex
                );

                await h.assert.dispute.initiatedAndCommitedWait();
                h.assert.storage.honestPeersStoredFraudProof({
                    fraudProofType: FraudProofType.BlockInvalidStateTransition,
                    maliciousPeerIndex
                });

                // The block's add() executed on honest VMs before the snapshot-hash
                // check failed; the abort must have rolled the state back.
                for (let i = 0; i < honestPeers.length; i++) {
                    expect(
                        await honestPeers[i].contractInstance.getSum(),
                        `Peer ${honestPeers[i].index} VM state not restored after rejected block`
                    ).to.equal(honestSumsBefore[i]);
                }

                await h.assert.storage.storedDisputeConfirmationsWait();

                await h.dispute.resolveDisputeWait();
                await h.assert.sync.onlyHonestPeersInSync();
            }
        )
    );
});
