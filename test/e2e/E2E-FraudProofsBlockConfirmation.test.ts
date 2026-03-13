import { FraudProofType } from "@/types/sol-enums";
import { TestSession, PeerTestHarness } from "@test/harness";

PeerTestHarness.setDefaultLogLevel("debug");

/**
 * E2E Tests: Fraud Proofs — onBlockConfirmation (BlockValidationStrategy)
 */

describe("E2E: Fraud Proofs - onBlockConfirmation pipeline — dispute-creating fraud proofs", function () {
    it("onBlockConfirmation pipeline: doubleSignDetected creates dispute with BlockDoubleSign", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 2, { waitForFinalization: true });
        const maliciousPeerIndex = 1;
        await h.byzantine.submitDoubleSignBlock(maliciousPeerIndex);

        await h.assert.dispute.initiatedAndCommitedWait({
            allowByzantineInitiation: true
        });
        h.assert.storage.honestPeersStoredFraudProof({
            fraudProofType: FraudProofType.BlockDoubleSign,
            maliciousPeerIndex
        });

        await h.dispute.resolveDisputeWait({
            maliciousPeerIndex
        });
        await h.assert.sync.onlyHonestPeersInSync();
    });

    it("onBlockConfirmation pipeline: wrongGenesisDetected creates dispute with WrongGenesis", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 2, { waitForFinalization: true });

        // Peer 2 submits a competing block at height 0 with a wrong previousBlockHash.
        const maliciousPeerIndex = 2;
        await h.byzantine.submitWrongGenesisBlock(maliciousPeerIndex);

        await h.assert.dispute.initiatedAndCommitedWait({
            allowByzantineInitiation: true
        });
        h.assert.storage.honestPeersStoredFraudProof({
            fraudProofType: FraudProofType.WrongGenesis,
            maliciousPeerIndex
        });

        await h.dispute.resolveDisputeWait({ maliciousPeerIndex });
        await h.assert.sync.onlyHonestPeersInSync();
    });

    it("onBlockConfirmation pipeline: invalidStateTransitionDetected (unexpected next leader) creates dispute with BlockInvalidStateTransition", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 3, { waitForFinalization: true });

        const maliciousPeerIndex = 1; // NOT the expected next leader
        await h.byzantine.submitUnexpectedNextLeaderBlock(maliciousPeerIndex);

        await h.assert.dispute.initiatedAndCommitedWait({
            allowByzantineInitiation: true
        });
        //  this fails with a race condition, some peers see the fork as disputed and fail the validation pipleine on `isDisputedFork` check
        //  which runs before the next-leader check -> they never store the fraud proof
        //
        h.assert.storage.honestPeersStoredFraudProof({
            fraudProofType: FraudProofType.BlockInvalidStateTransition,
            maliciousPeerIndex
        });

        await h.dispute.resolveDisputeWait({ maliciousPeerIndex });
        await h.assert.sync.onlyHonestPeersInSync();
    });

    it.only("onBlockConfirmation pipeline: objectiveInvalidTimestampDetected creates dispute with InvalidTimestamp", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 2, { waitForFinalization: true });

        // Peer 2 submits a block with a timestamp before the previous block's
        // timestamp → objectiveInvalidTimestampDetected → InvalidTimestamp.
        const maliciousPeerIndex = 2;
        await h.byzantine.submitInvalidTimestampBlock(maliciousPeerIndex);

        //  this fails with a race condition, some peers see the fork as disputed and fail the validation pipleine on `isDisputedFork` check
        //  which runs before the subjective invalid timestamp check -> they never store the fraud proof
        await h.assert.dispute.initiatedAndCommitedWait({
            allowByzantineInitiation: true
        });
        h.assert.storage.honestPeersStoredFraudProof({
            fraudProofType: FraudProofType.InvalidTimestamp,
            maliciousPeerIndex
        });

        await h.dispute.resolveDisputeWait({ maliciousPeerIndex });
        await h.assert.sync.onlyHonestPeersInSync();
    });

    it("onBlockConfirmation pipeline: findBrokenInboundMessageChainBlock creates dispute with BlockInvalidStateTransition", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 2, { waitForFinalization: true });

        // Peer 2 submits a block that includes a messageBlock whose
        // previousBlockHash does not chain from the stored inbound state
        // → findBrokenInboundMessageChainBlock fires after validateBlockConfirmation
        // succeeds → invalidStateTransitionDetected → BlockInvalidStateTransition.
        const maliciousPeerIndex = 2;
        await h.byzantine.submitBrokenInboundChainBlock(maliciousPeerIndex);

        await h.assert.dispute.initiatedAndCommitedWait({
            allowByzantineInitiation: true
        });
        h.assert.storage.honestPeersStoredFraudProof({
            fraudProofType: FraudProofType.BlockInvalidStateTransition,
            maliciousPeerIndex
        });

        await h.dispute.resolveDisputeWait({ maliciousPeerIndex });
        await h.assert.sync.onlyHonestPeersInSync();
    });

    it("onBlockConfirmation pipeline: forgedInboundMessageBlockDetected creates dispute with ForgedInboundMessageBlock", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 2, { waitForFinalization: true });

        // Peer 2 submits a block that contains a fabricated inbound message
        // block that was never actually sent by any peer
        // → detectForgedInboundMessageBlock fires → forgedInboundMessageBlockDetected
        // → ForgedInboundMessageBlock.
        const maliciousPeerIndex = 2;
        await h.byzantine.submitForgedInboundMessageBlock(maliciousPeerIndex);

        await h.assert.dispute.initiatedAndCommitedWait({
            allowByzantineInitiation: true
        });
        h.assert.storage.honestPeersStoredFraudProof({
            fraudProofType: FraudProofType.ForgedInboundMessageBlock,
            maliciousPeerIndex
        });

        await h.dispute.resolveDisputeWait({ maliciousPeerIndex });
        await h.assert.sync.onlyHonestPeersInSync();
    });

    it("onBlockConfirmation pipeline: applyTransaction failure creates dispute with BlockInvalidStateTransition", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 2, { waitForFinalization: true });

        // Peer 2 submits a block whose transaction body is malformed data that
        // the contract rejects; applyTransaction returns success=false
        // → invalidStateTransitionDetected → BlockInvalidStateTransition.
        const maliciousPeerIndex = 2;
        await h.byzantine.submitInvalidTransactionDataBlock(maliciousPeerIndex);

        await h.assert.dispute.initiatedAndCommitedWait({
            allowByzantineInitiation: true
        });
        h.assert.storage.honestPeersStoredFraudProof({
            fraudProofType: FraudProofType.BlockInvalidStateTransition,
            maliciousPeerIndex
        });

        await h.dispute.resolveDisputeWait({ maliciousPeerIndex });
        await h.assert.sync.onlyHonestPeersInSync();
    });

    it("onBlockConfirmation pipeline: stateSnapshotHash mismatch creates dispute with BlockInvalidStateTransition", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 2, { waitForFinalization: true });

        // Peer 2 submits a block with a valid transaction but a wrong
        // stateSnapshotHash (ZeroHash).
        const maliciousPeerIndex = 2;
        await h.byzantine.submitInvalidStateTransitionBlock(maliciousPeerIndex);

        await h.assert.dispute.initiatedAndCommitedWait({
            allowByzantineInitiation: true
        });
        h.assert.storage.honestPeersStoredFraudProof({
            fraudProofType: FraudProofType.BlockInvalidStateTransition,
            maliciousPeerIndex
        });

        await h.dispute.resolveDisputeWait({ maliciousPeerIndex });
        await h.assert.sync.onlyHonestPeersInSync();
    });
});
