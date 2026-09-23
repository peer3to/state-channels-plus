import * as factory from "../factory";
import Clock from "@/Clock";
import { StateSnapshot } from "@/models";
import Storage from "@/storage";
import { BlockOrigin } from "@/storage/QueueStorage";
import { ForkId } from "@/types/types";
import { expect } from "chai";
import { ethers } from "hardhat";
import { describe, it, before, beforeEach } from "mocha";

describe("Storage.clear", () => {
    let storage: Storage;
    let forkId: ForkId;
    const blockOnFork = (fork = forkId) =>
        factory.block({ header: { forkId: fork, transactionCnt: 0 } });

    before(async () => {
        await Clock.init(ethers.provider);
    });

    beforeEach(() => {
        storage = new Storage();
        forkId = factory.hash();
    });

    it("drops stored blocks and their fork height watermark", () => {
        const block = blockOnFork();
        storage.blocks.storeBlock(block);
        const heightBefore = storage.blocks.getNextBlockHeight(forkId);

        storage.clear();

        expect({
            heightBefore,
            block: storage.blocks.getBlock(block.hash),
            heightAfter: storage.blocks.getNextBlockHeight(forkId)
        }).to.deep.equal({
            heightBefore: 1,
            block: undefined,
            heightAfter: 0
        });
    });

    it("drops stored state snapshots including the fork genesis", () => {
        const snapshot = factory.stateSnapshot();
        const genesisStruct = snapshot.toStruct();
        genesisStruct.forkId = snapshot.snapshotDataHash;
        const genesis = StateSnapshot.from(genesisStruct);
        storage.stateSnapshots.storeStateSnapshot(genesis);
        const storedBefore = storage.stateSnapshots.getStateSnapshotByHash(
            genesis.hash
        );

        storage.clear();

        expect({
            storedBefore: storedBefore !== undefined,
            byHash: storage.stateSnapshots.getStateSnapshotByHash(genesis.hash),
            genesis: storage.stateSnapshots.getGenesisSnapshotByForkId(
                genesis.snapshotDataHash
            )
        }).to.deep.equal({
            storedBefore: true,
            byHash: undefined,
            genesis: undefined
        });
    });

    it("drops stored state machine states", () => {
        const encodedState = factory.hexString(64);
        const stateHash =
            storage.stateMachineStates.storeStateMachineState(encodedState);
        const storedBefore =
            storage.stateMachineStates.getStateMachineState(stateHash);

        storage.clear();

        expect({
            storedBefore,
            after: storage.stateMachineStates.getStateMachineState(stateHash)
        }).to.deep.equal({ storedBefore: encodedState, after: undefined });
    });

    it("drops recorded participant set change points", () => {
        storage.participantSetChanges.storeChangePoint(forkId, 3);
        const before =
            storage.participantSetChanges.getChangePointsInRange(forkId);

        storage.clear();

        expect({
            before,
            after: storage.participantSetChanges.getChangePointsInRange(forkId)
        }).to.deep.equal({ before: [3], after: [] });
    });

    it("drops queued blocks and their coordinate index", () => {
        const block = blockOnFork();
        storage.queues.queueBlock(block, { origin: BlockOrigin.CALLDATA });
        const queuedBefore = storage.queues.isBlockQueued(block);

        storage.clear();

        expect({
            queuedBefore,
            queuedAfter: storage.queues.isBlockQueued(block),
            entry: storage.queues.getQueuedEntry(block.hash),
            dequeued: storage.queues.tryDequeueAt(forkId, 0)
        }).to.deep.equal({
            queuedBefore: true,
            queuedAfter: false,
            entry: undefined,
            dequeued: []
        });
    });

    it("drops stored disputes and the disputed fork marker", () => {
        const signedDispute = factory.signedDispute();
        const disputeHash = storage.disputes.storeDispute(signedDispute);
        storage.disputes.storeDisputedFork(forkId, true);
        const disputedBefore = storage.disputes.didIDispute(forkId);

        storage.clear();

        expect({
            disputedBefore,
            dispute: storage.disputes.getDispute(disputeHash),
            disputedAfter: storage.disputes.didIDispute(forkId)
        }).to.deep.equal({
            disputedBefore: true,
            dispute: undefined,
            disputedAfter: false
        });
    });

    it("drops stored fraud proofs and their participant index", () => {
        const proofHash = storage.fraudProofs.storeFraudProof(
            factory.fraudProof()
        );
        const storedBefore =
            storage.fraudProofs.getFraudProofByHash(proofHash) !== undefined;

        storage.clear();

        expect({
            storedBefore,
            after: storage.fraudProofs.getFraudProofByHash(proofHash)
        }).to.deep.equal({ storedBefore: true, after: undefined });
    });

    it("drops stored dispute fraud proofs", () => {
        storage.disputeFraudProofs.storeFraudProof(
            factory.disputeFraudProof(factory.dispute())
        );
        const countBefore =
            storage.disputeFraudProofs.getDisputeFraudProofs().length;

        storage.clear();

        expect({
            countBefore,
            countAfter:
                storage.disputeFraudProofs.getDisputeFraudProofs().length
        }).to.deep.equal({ countBefore: 1, countAfter: 0 });
    });

    it("drops stored fork timeouts", () => {
        storage.timeout.storeTimeout(forkId, factory.timeout());
        const before = storage.timeout.getTimeout(forkId) !== undefined;

        storage.clear();

        expect({
            before,
            after: storage.timeout.getTimeout(forkId)
        }).to.deep.equal({ before: true, after: undefined });
    });

    it("drops the force exit marker", () => {
        storage.forceExit.setForceExit(true);
        const before = storage.forceExit.getForceExit();

        storage.clear();

        expect({
            before,
            after: storage.forceExit.getForceExit()
        }).to.deep.equal({ before: true, after: false });
    });

    it("drops the force join submission state", () => {
        storage.forceJoin.setJoinSubmissionBlockHeight(7);
        storage.forceJoin.setDisputeStarted();
        const before = {
            height: storage.forceJoin.getJoinSubmissionBlockHeight(),
            disputeStarted: storage.forceJoin.hasDisputeStarted()
        };

        storage.clear();

        expect({
            before,
            height: storage.forceJoin.getJoinSubmissionBlockHeight(),
            disputeStarted: storage.forceJoin.hasDisputeStarted()
        }).to.deep.equal({
            before: { height: 7, disputeStarted: true },
            height: undefined,
            disputeStarted: false
        });
    });

    it("drops stored block calldata", () => {
        const block = blockOnFork();
        storage.blockCalldata.storeBlockCalldata({
            signedBlock: factory.signedBlock({ encodedBlock: block.encode() }),
            onChainTimestamp: 1
        });
        const before =
            storage.blockCalldata.getBlockCalldata(
                forkId,
                block.height,
                block.author
            ) !== undefined;

        storage.clear();

        expect({
            before,
            after: storage.blockCalldata.getBlockCalldata(
                forkId,
                block.height,
                block.author
            )
        }).to.deep.equal({ before: true, after: undefined });
    });

    it("drops the latest processed chain block per channel", () => {
        const channelId = factory.hash();
        storage.eventSync.storeLatestProcessedBlock(channelId, 42);
        const before = storage.eventSync.getLatestProcessedBlock(channelId);

        storage.clear();

        expect({
            before,
            after: storage.eventSync.getLatestProcessedBlock(channelId)
        }).to.deep.equal({ before: 42, after: undefined });
    });

    it("drops inbound and outbound message blocks with their latest markers", () => {
        const inboundHash = storage.inboundMessages.store(
            factory.messageBlock()
        );
        const outboundHash = storage.outboundMessages.store(
            factory.messageBlock()
        );
        const before = {
            inbound:
                storage.inboundMessages.getMessageBlock(inboundHash) !==
                undefined,
            outbound:
                storage.outboundMessages.getMessageBlock(outboundHash) !==
                undefined
        };

        storage.clear();

        expect({
            before,
            inbound: storage.inboundMessages.getMessageBlock(inboundHash),
            outbound: storage.outboundMessages.getMessageBlock(outboundHash),
            latestInbound: storage.inboundMessages.getLatestMessageBlock(),
            latestOutbound: storage.outboundMessages.getLatestMessageBlock(),
            latestInboundHash: storage.inboundMessages.getLatestBlockHash(),
            latestOutboundHash: storage.outboundMessages.getLatestBlockHash()
        }).to.deep.equal({
            before: { inbound: true, outbound: true },
            inbound: undefined,
            outbound: undefined,
            latestInbound: undefined,
            latestOutbound: undefined,
            latestInboundHash: undefined,
            latestOutboundHash: undefined
        });
    });

    it("keeps recorded blacklist verdicts", () => {
        const address = ethers.Wallet.createRandom().address;
        storage.blacklist.record(address, "proven fault");

        storage.clear();

        expect(storage.blacklist.get(address)).to.deep.equal({
            address,
            reason: "proven fault"
        });
    });

    it("rebuilds the queue with the contract's participant bound", () => {
        const bounded = new Storage(2);

        bounded.clear();

        expect(bounded.queues.maxChannelParticipants).to.equal(2);
    });

    it("stays empty when cleared twice", () => {
        const block = blockOnFork();
        storage.blocks.storeBlock(block);
        storage.disputes.storeDisputedFork(forkId, true);

        storage.clear();
        storage.clear();

        expect({
            block: storage.blocks.getBlock(block.hash),
            disputed: storage.disputes.didIDispute(forkId)
        }).to.deep.equal({ block: undefined, disputed: false });
    });

    it("accepts new entries after clearing", () => {
        const first = blockOnFork();
        storage.blocks.storeBlock(first);
        storage.clear();

        const second = blockOnFork(factory.hash());
        const storedHash = storage.blocks.storeBlock(second);

        expect({
            storedHash: storedHash === second.hash,
            readBack: storage.blocks.getBlock(second.hash)?.hash,
            oldFork: storage.blocks.getBlock(first.hash)
        }).to.deep.equal({
            storedHash: true,
            readBack: second.hash,
            oldFork: undefined
        });
    });

    it("leaves an untouched storage instance empty", () => {
        const untouched = new Storage();

        untouched.clear();

        expect({
            block: untouched.blocks.getBlock(factory.hash()),
            forceExit: untouched.forceExit.getForceExit(),
            disputeProofs: untouched.disputeFraudProofs.getDisputeFraudProofs()
        }).to.deep.equal({
            block: undefined,
            forceExit: false,
            disputeProofs: []
        });
    });
});
