import { expect } from "chai";
import { ethers } from "hardhat";
import * as sinon from "sinon";
import EventMirror from "@/EventMirror";
import { EventEmitter } from "events";

// Create a mock on-chain proxy using EventEmitter
class MockOnChainProxy extends EventEmitter {
    filters = {
        ChannelSnapshotSet: () => "ChannelSnapshotSet",
        BlockCalldataCommitmentSet: () => "BlockCalldataCommitmentSet",
        OnChainJoinChannelSet: () => "OnChainJoinChannelSet",
        OnChainJoinChannelDeleted: () => "OnChainJoinChannelDeleted",
        LatestJoinChannelBlockHashSet: () => "LatestJoinChannelBlockHashSet",
        TotalOnChainWithdrawalsSet: () => "TotalOnChainWithdrawalsSet",
        PendingParticipantAdded: () => "PendingParticipantAdded",
        DisputeWindowCreated: () => "DisputeWindowCreated",
        DisputeWindowCreationTimestampSet: () =>
            "DisputeWindowCreationTimestampSet",
        DisputeCommitmentsCleared: () => "DisputeCommitmentsCleared",
        DisputeCommitmentPushed: () => "DisputeCommitmentPushed",
        DisputeCommitmentRemoved: () => "DisputeCommitmentRemoved",
        HasPostedSet: () => "HasPostedSet",
        DisputeWindowDeleted: () => "DisputeWindowDeleted",
        ReducedResultCommitted: () => "ReducedResultCommitted",
        ReducedResultForkIdCleared: () => "ReducedResultForkIdCleared",
        DisputedForkRemoved: () => "DisputedForkRemoved",
        OnChainSlashedAdded: () => "OnChainSlashedAdded"
    };

    // Simulate on-chain operations that emit events
    setChannelSnapshot(channelId: string, stateSnapshot: any) {
        this.emit("ChannelSnapshotSet", channelId, stateSnapshot);
    }

    setBlockCalldataCommitment(
        channelId: string,
        participant: string,
        forkId: string,
        blockHeight: bigint,
        commitment: string
    ) {
        this.emit(
            "BlockCalldataCommitmentSet",
            channelId,
            participant,
            forkId,
            blockHeight,
            commitment
        );
    }

    addPendingParticipant(channelId: string, participant: string) {
        this.emit("PendingParticipantAdded", channelId, participant);
    }
}

describe("EventMirror", function () {
    let onChainProxy: MockOnChainProxy;
    let localDiamond: any;
    let eventMirror: EventMirror;

    beforeEach(function () {
        // Create mock local diamond with all required methods
        localDiamond = {
            setChannelSnapshot: sinon.spy(),
            setBlockCalldataCommitment: sinon.spy(),
            setOnChainJoinChannel: sinon.spy(),
            deleteOnChainJoinChannel: sinon.spy(),
            setLatestJoinChannelBlockHash: sinon.spy(),
            setTotalOnChainWithdrawals: sinon.spy(),
            addPendingParticipant: sinon.spy(),
            createDisputeWindow: sinon.spy(),
            setDisputeWindowCreationTimestamp: sinon.spy(),
            clearDisputeCommitments: sinon.spy(),
            pushDisputeCommitment: sinon.spy(),
            removeDisputeCommitment: sinon.spy(),
            setHasPosted: sinon.spy(),
            deleteDisputeWindow: sinon.spy(),
            commitReducedResult: sinon.spy(),
            clearReducedResultForkId: sinon.spy(),
            removeDisputedFork: sinon.spy(),
            addOnChainSlash: sinon.spy()
        };

        // Create fresh instances for each test
        onChainProxy = new MockOnChainProxy();
        eventMirror = new EventMirror(onChainProxy as any, localDiamond as any);
        eventMirror.startMirroring();
    });

    it("should mirror ChannelSnapshotSet events", async function () {
        // Test data
        const channelId = ethers.id("testChannel");
        const stateSnapshot = {
            state: "0x1234",
            blockHeight: 100n,
            forkId: ethers.id("testFork")
        };

        // 1. Call on-chain operation
        onChainProxy.setChannelSnapshot(channelId, stateSnapshot);

        // Wait for event processing
        await new Promise((resolve) => setImmediate(resolve));

        // 2. Verify local state changed
        expect(localDiamond.setChannelSnapshot.calledOnce).to.be.true;
        expect(localDiamond.setChannelSnapshot.firstCall.args[0]).to.equal(
            channelId
        );
        expect(localDiamond.setChannelSnapshot.firstCall.args[1]).to.equal(
            stateSnapshot
        );
    });

    it("should mirror BlockCalldataCommitmentSet events", async function () {
        // Test data
        const channelId = ethers.id("testChannel");
        const participant = "0x" + "1".repeat(40);
        const forkId = ethers.id("testFork");
        const blockHeight = 42n;
        const commitment = ethers.id("testCommitment");

        // 1. Call on-chain operation
        onChainProxy.setBlockCalldataCommitment(
            channelId,
            participant,
            forkId,
            blockHeight,
            commitment
        );

        // Wait for event processing
        await new Promise((resolve) => setImmediate(resolve));

        // 2. Verify local state changed
        expect(localDiamond.setBlockCalldataCommitment.calledOnce).to.be.true;
        const args = localDiamond.setBlockCalldataCommitment.firstCall.args;
        expect(args[0]).to.equal(channelId);
        expect(args[1]).to.equal(participant);
        expect(args[2]).to.equal(forkId);
        expect(args[3]).to.equal(blockHeight);
        expect(args[4]).to.equal(commitment);
    });

    it("should mirror PendingParticipantAdded events", async function () {
        // Test data
        const channelId = ethers.id("gameChannel");
        const participant = "0x" + "2".repeat(40);

        // 1. Call on-chain operation
        onChainProxy.addPendingParticipant(channelId, participant);

        // Wait for event processing
        await new Promise((resolve) => setImmediate(resolve));

        // 2. Verify local state changed
        expect(localDiamond.addPendingParticipant.calledOnce).to.be.true;
        expect(localDiamond.addPendingParticipant.firstCall.args[0]).to.equal(
            channelId
        );
        expect(localDiamond.addPendingParticipant.firstCall.args[1]).to.equal(
            participant
        );
    });

    it("should mirror multiple events in sequence", async function () {
        const channelId = ethers.id("multiTestChannel");

        // 1. Emit multiple events
        onChainProxy.setChannelSnapshot(channelId, { state: "0xabc" });
        onChainProxy.addPendingParticipant(channelId, "0x" + "3".repeat(40));
        onChainProxy.setBlockCalldataCommitment(
            channelId,
            "0x" + "4".repeat(40),
            ethers.id("fork"),
            10n,
            ethers.id("commit")
        );

        // Wait for all events to process
        await new Promise((resolve) => setImmediate(resolve));

        // 2. Verify all were mirrored
        expect(localDiamond.setChannelSnapshot.calledOnce).to.be.true;
        expect(localDiamond.addPendingParticipant.calledOnce).to.be.true;
        expect(localDiamond.setBlockCalldataCommitment.calledOnce).to.be.true;
    });
});
