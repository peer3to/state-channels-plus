import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
import { Logger, Codec, Type } from "@/utils";
import { ForkId, Bytes, Hash, BlockHeight } from "@/types/types";
import Block from "@/models/Block";
import {
    BlockStruct,
    TransactionStruct,
    MessageBlockStruct,
    MessageStruct,
    BalanceStruct,
    SignedBlockStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import { ethers, ZeroHash } from "ethers";
import Clock from "@/Clock";
import { hash } from "@/utils";
import {
    DisputeTampering,
    DisputeTamper
} from "@test/harness/actions/DisputeTamperingActions";
import { DisputeStruct } from "@typechain-types/contracts/V1/types/ProofTypes";

export class ByzantineActions {
    constructor(
        private harness: PeerTestHarness,
        private logger: Logger
    ) {}

    /**
     * Submit a double-signed block (two blocks at same height with different content)
     */
    async submitDoubleSignBlock(
        peerIndex: number,
        options?: {
            forkId?: ForkId;
            transactionData?: Bytes;
        }
    ): Promise<{
        conflictingBlock: Block;
        originalBlock: Block;
    }> {
        const peer = this.harness.getPeer(peerIndex);
        this.harness.contextApi.markMaliciousPeer({
            maliciousPeerIndex: peerIndex
        });
        const forkId = options?.forkId || this.harness.activeForkId!;

        this.logger.debug(
            `Peer ${peerIndex} creating double-sign block for fork ${forkId}`
        );

        const originalBlock =
            peer.stateManager.storage.blocks.getLatestBlock(forkId);
        if (!originalBlock) {
            throw new Error(`No block found for fork ${forkId}`);
        }

        this.logger.debug(
            `Original block found: height=${originalBlock.height}, hash=${originalBlock.hash}`
        );

        // Create conflicting block with same coordinates but different content
        const conflictingTransactionData: Bytes =
            options?.transactionData ||
            (ethers.hexlify(ethers.randomBytes(64)) as Bytes);

        const conflictingStateSnapshotHash: Hash = hash(
            ethers.randomBytes(32)
        ) as Hash;

        const conflictingBlockStruct: BlockStruct = {
            transaction: {
                header: {
                    channelId: originalBlock.channelId,
                    participant: originalBlock.author,
                    forkId: originalBlock.forkId,
                    transactionCnt: BigInt(originalBlock.height),
                    timestamp: originalBlock.timestamp
                },
                body: {
                    encodedData: conflictingTransactionData,
                    data: conflictingTransactionData
                }
            },
            stateSnapshotHash: conflictingStateSnapshotHash,
            previousBlockHash: originalBlock.previousBlockHash,
            messageBlocks: []
        };

        const conflictingBlock = await Block.fromBlockStruct(
            conflictingBlockStruct,
            peer.signer
        );

        this.logger.info(
            `Peer ${peerIndex} broadcasting double-sign block: height=${conflictingBlock.height}, hash=${conflictingBlock.hash}`
        );

        // Broadcast
        peer.p2pInstance.p2pSigner.p2pManager.remoteRpc.stateTransitionService
            .onBlockConfirmation(conflictingBlock.blockConfirmationStruct)
            .broadcast();

        this.logger.info(`Double-sign block broadcasted by peer ${peerIndex}`);

        return {
            conflictingBlock,
            originalBlock
        };
    }

    /**
     * Submit an invalid state transition block (wrong state snapshot hash)
     */
    async submitInvalidStateTransitionBlock(
        peerIndex: number,
        options?: {
            forkId?: ForkId;
            transactionData?: Bytes;
            wrongStateSnapshotHash?: Hash;
        }
    ): Promise<Block> {
        const peer = this.harness.getPeer(peerIndex);
        this.harness.contextApi.markMaliciousPeer({
            maliciousPeerIndex: peerIndex
        });
        const forkId = options?.forkId || this.harness.activeForkId!;

        this.logger.debug(
            `Peer ${peerIndex} creating invalid state transition block for fork ${forkId}`
        );

        const latestBlock =
            peer.stateManager.storage.blocks.getLatestBlock(forkId);
        if (!latestBlock) {
            throw new Error(`No block found for fork ${forkId}`);
        }

        const nextBlockHeight =
            peer.stateManager.storage.blocks.getNextBlockHeight(forkId);
        const previousBlockHash = this.harness.query.getPreviousBlockHash(
            peer,
            forkId,
            nextBlockHeight
        );

        // Create a valid transaction
        let transactionData: Bytes;
        if (options?.transactionData) {
            transactionData = options.transactionData;
        } else {
            const contractInterface = peer.contractInstance.interface;
            transactionData = contractInterface.encodeFunctionData("add", [
                1
            ]) as Bytes;
        }

        const transaction: TransactionStruct = {
            header: {
                channelId: peer.stateManager.getChannelId(),
                participant: peer.address,
                forkId: forkId,
                transactionCnt: BigInt(nextBlockHeight),
                timestamp: BigInt(latestBlock.timestamp) + 1n
            },
            body: {
                encodedData: transactionData,
                data: transactionData
            }
        };

        const wrongStateSnapshotHash: Hash =
            options?.wrongStateSnapshotHash || (ZeroHash as Hash);

        const blockStruct: BlockStruct = {
            transaction: transaction,
            stateSnapshotHash: wrongStateSnapshotHash,
            previousBlockHash: previousBlockHash,
            messageBlocks: []
        };

        const invalidBlock = await Block.fromBlockStruct(
            blockStruct,
            peer.signer
        );

        this.logger.info(
            `Peer ${peerIndex} creating invalid state transition block: height=${invalidBlock.height}, hash=${invalidBlock.hash}, wrongStateSnapshotHash=${wrongStateSnapshotHash}`
        );

        // Broadcast the invalid block from the specified peer
        peer.p2pInstance.p2pSigner.p2pManager.remoteRpc.stateTransitionService
            .onBlockConfirmation(invalidBlock.blockConfirmationStruct)
            .broadcast();

        this.logger.info(
            `Invalid state transition block broadcasted by peer ${peerIndex}`
        );

        return invalidBlock;
    }

    /**
     * Submit a forged inbound message block
     */
    async submitForgedInboundMessageBlock(
        peerIndex: number,
        options?: {
            forkId?: ForkId;
        }
    ): Promise<Block> {
        const peer = this.harness.getPeer(peerIndex);
        this.harness.contextApi.markMaliciousPeer({
            maliciousPeerIndex: peerIndex
        });
        const forkId = options?.forkId || this.harness.activeForkId!;

        const nextBlockHeight =
            peer.stateManager.storage.blocks.getNextBlockHeight(forkId);
        const previousBlock =
            peer.stateManager.storage.blocks.getLatestBlock(forkId);
        const previousBlockHash = this.harness.query.getPreviousBlockHash(
            peer,
            forkId,
            nextBlockHeight
        );
        const stateSnapshotHash = this.harness.query.getStateSnapshotHash(
            peer,
            forkId,
            previousBlock
        );

        const previousStateSnapshot =
            peer.stateManager.storage.getPreviousStateSnapshot({
                forkId,
                height: nextBlockHeight
            });
        if (!previousStateSnapshot) {
            throw new Error(
                `Unable to compute previous snapshot for fork ${forkId}`
            );
        }

        const latestInboundHash = (previousStateSnapshot.snapshotData
            .latestInboundMessageBlockHash ?? ZeroHash) as Hash;
        const latestInboundHeightValue =
            previousStateSnapshot.snapshotData
                .latestInboundMessageBlockHeight ?? 0n;
        const latestInboundHeight =
            typeof latestInboundHeightValue === "bigint"
                ? latestInboundHeightValue
                : BigInt(latestInboundHeightValue);
        const forgedInboundHeight = latestInboundHeight + 1n;

        const forgedMessage: MessageStruct = {
            messageType: ethers.hexlify(ethers.randomBytes(32)) as Bytes,
            participant: peer.address,
            balance: {
                amount: 1n,
                data: "0x"
            },
            data: ethers.hexlify(ethers.randomBytes(32)) as Bytes
        };

        const totalBalance: BalanceStruct = {
            amount: forgedMessage.balance.amount,
            data: "0x"
        };

        const forgedMessageBlock: MessageBlockStruct = {
            previousBlockHash: latestInboundHash || (ZeroHash as Hash),
            blockHeight: forgedInboundHeight,
            messages: [forgedMessage],
            totalBalance,
            timestamp: BigInt(Clock.getTimeInSeconds())
        };

        const contractInterface = peer.contractInstance.interface;
        const transactionData = contractInterface.encodeFunctionData("add", [
            1
        ]) as Bytes;

        const blockTimestampBase = previousBlock
            ? previousBlock.timestamp + 1
            : Clock.getTimeInSeconds();

        const transaction: TransactionStruct = {
            header: {
                channelId: peer.stateManager.getChannelId(),
                participant: peer.address,
                forkId,
                transactionCnt: BigInt(nextBlockHeight),
                timestamp: BigInt(blockTimestampBase)
            },
            body: {
                encodedData: transactionData,
                data: transactionData
            }
        };

        const blockStruct: BlockStruct = {
            transaction,
            stateSnapshotHash,
            previousBlockHash,
            messageBlocks: [forgedMessageBlock]
        };

        const forgedBlock = await Block.fromBlockStruct(
            blockStruct,
            peer.signer
        );

        this.logger.info(
            `Peer ${peerIndex} broadcasting forged inbound message block at height ${forgedBlock.height}`,
            { forkId }
        );

        this.harness.contextApi.markMaliciousPeer({
            maliciousPeerIndex: peerIndex
        });

        peer.p2pInstance.p2pSigner.p2pManager.remoteRpc.stateTransitionService
            .onBlockConfirmation(forgedBlock.blockConfirmationStruct)
            .broadcast();

        return forgedBlock;
    }

    /**
     * Post junk calldata on-chain with an invalid signature
     */
    async postJunkCalldataOnChain(
        peerIndex: number,
        options: {
            height: BlockHeight;
            forkId?: ForkId;
            encodedData?: Bytes;
        }
    ): Promise<BlockStruct> {
        const peer = this.harness.getPeer(peerIndex);
        this.harness.contextApi.markMaliciousPeer({
            maliciousPeerIndex: peerIndex
        });
        const forkId = options.forkId || this.harness.activeForkId!;
        const height = options.height;

        const previousBlock =
            peer.stateManager.storage.blocks.getLatestBlock(forkId);
        const previousBlockHash = this.harness.query.getPreviousBlockHash(
            peer,
            forkId
        );
        const stateSnapshotHash = this.harness.query.getStateSnapshotHash(
            peer,
            forkId,
            previousBlock
        );

        const encodedData: Bytes =
            options.encodedData ||
            (ethers.hexlify(ethers.randomBytes(64)) as Bytes);

        const transaction: TransactionStruct = {
            header: {
                channelId: peer.stateManager.getChannelId(),
                participant: peer.address,
                forkId: forkId,
                transactionCnt: BigInt(height),
                timestamp: BigInt(Clock.getTimeInSeconds())
            },
            body: {
                encodedData: encodedData,
                data: encodedData
            }
        };

        const blockStruct: BlockStruct = {
            transaction: transaction,
            stateSnapshotHash: stateSnapshotHash,
            previousBlockHash: previousBlockHash,
            messageBlocks: []
        };

        // Create invalid signature by corrupting the hash
        const encodedBlock = Codec.encode(blockStruct, Type.Block);
        const blockHash = hash(encodedBlock);
        const corruptedBlockHash = hash(blockHash);
        const invalidSignature = await peer.signer.signMessage(
            ethers.getBytes(corruptedBlockHash)
        );

        const signedBlock: SignedBlockStruct = {
            encodedBlock: encodedBlock,
            signature: invalidSignature
        };

        const maxTimestamp = Clock.getTimeInSeconds() + 1000;

        this.logger.debug(
            `Peer ${peerIndex} posting junk calldata with invalid signature for height ${height}`,
            { forkId }
        );

        const tx =
            await peer.stateManager.stateChannelManagerContract.postBlockCalldata(
                signedBlock,
                maxTimestamp
            );
        await tx.wait();

        this.logger.info(`Junk calldata posted on-chain by peer ${peerIndex}`);

        return blockStruct;
    }

    async invalidTransitionFromNext(): Promise<void> {
        const forkId = this.harness.activeForkId;
        if (!forkId) {
            throw new Error("No active fork ID - channel must be opened first");
        }

        const maliciousPeer = await this.harness.query.getNextPeerToWrite();
        this.harness.contextApi.markMaliciousPeer({
            maliciousPeerIndex: maliciousPeer.index
        });
        await this.submitInvalidStateTransitionBlock(maliciousPeer.index, {
            forkId
        });
    }

    async forgedInboundMessageFromNext(): Promise<void> {
        const forkId = this.harness.activeForkId;
        if (!forkId) {
            throw new Error("No active fork ID - channel must be opened first");
        }

        const maliciousPeer = await this.harness.query.getNextPeerToWrite();
        this.harness.contextApi.markMaliciousPeer({
            maliciousPeerIndex: maliciousPeer.index
        });
        await this.submitForgedInboundMessageBlock(maliciousPeer.index, {
            forkId
        });
    }

    async postTamperedDisputeWith(
        peerIndex: number,
        tamperFn: DisputeTamper
    ): Promise<DisputeStruct> {
        const forkId = this.harness.activeForkId;
        if (!forkId) {
            throw new Error("No active fork ID - channel must be opened first");
        }

        const { dispute } = await this.harness.tamper.postTamperedDispute(
            peerIndex,
            tamperFn,
            forkId
        );
        this.harness.contextApi.markMaliciousPeer({
            maliciousPeerIndex: peerIndex
        });
        return dispute;
    }

    async postTamperedDisputeAuditingData(
        peerIndex: number
    ): Promise<DisputeStruct> {
        return this.postTamperedDisputeWith(
            peerIndex,
            DisputeTampering.tamperAuditingDataHash
        );
    }

    async postTamperedDisputeTimeout(options: {
        submitterIndex: number;
        wrongParticipantIndex: number;
        blockHeight?: number;
    }): Promise<DisputeStruct> {
        const {
            submitterIndex,
            wrongParticipantIndex,
            blockHeight = 2
        } = options;

        const wrongPeer = this.harness.peers[wrongParticipantIndex];
        if (!wrongPeer) {
            throw new Error(`Peer ${wrongParticipantIndex} not found`);
        }

        const tamperFn = DisputeTampering.createTamperTimeoutParticipant(
            wrongPeer.address,
            blockHeight
        );
        return this.postTamperedDisputeWith(submitterIndex, tamperFn);
    }

    async tamperedDisputePartialAuditing(
        peerIndex: number
    ): Promise<DisputeStruct> {
        return this.postTamperedDisputeWith(
            peerIndex,
            DisputeTampering.tamperPartialAuditing
        );
    }

    async tamperedDisputeDoubleFault(
        peerIndex: number
    ): Promise<DisputeStruct> {
        return this.postTamperedDisputeWith(
            peerIndex,
            DisputeTampering.tamperDoubleFault
        );
    }

    async tamperedDisputeInvalidStateProof(
        peerIndex: number
    ): Promise<DisputeStruct> {
        return this.postTamperedDisputeWith(
            peerIndex,
            DisputeTampering.tamperInvalidStateProof
        );
    }

    async tamperedDisputeInvalidStateProofWithCalldata(
        peerIndex: number
    ): Promise<DisputeStruct> {
        return this.postTamperedDisputeWith(
            peerIndex,
            DisputeTampering.tamperInvalidStateProofWithCalldata
        );
    }

    stubDisputeConstruction(options: {
        peerIndex: number;
        tamperFn: DisputeTamper;
    }): void {
        this.harness.tamper.stubConstructDispute(
            options.peerIndex,
            options.tamperFn
        );
    }

    restoreDisputeConstruction(peerIndex: number): void {
        this.harness.tamper.restoreConstructDispute(peerIndex);
    }

    async disconnect(peerIndex: number): Promise<void> {
        await this.harness.network.disconnectPeer(peerIndex);
    }

    stubCalldataHandler(peerIndex: number): void {
        const peer = this.harness.peers[peerIndex];
        if (!peer) {
            throw new Error(`Peer ${peerIndex} not found`);
        }

        const eventHandler = peer.stateManager.eventHandler;
        const original = eventHandler.onBlockCalldataPosted.bind(eventHandler);
        this.harness.context[`peer${peerIndex}OriginalCalldataHandler`] =
            original;
        eventHandler.onBlockCalldataPosted = async () => {};
    }

    restoreCalldataHandler(peerIndex: number): void {
        const peer = this.harness.peers[peerIndex];
        if (!peer) {
            throw new Error(`Peer ${peerIndex} not found`);
        }

        const original =
            this.harness.context[`peer${peerIndex}OriginalCalldataHandler`];
        if (!original) {
            throw new Error(
                `No original calldata handler found for peer ${peerIndex}`
            );
        }

        peer.stateManager.eventHandler.onBlockCalldataPosted = original;
    }

    stubBroadcast(peerIndex: number): void {
        const peer = this.harness.peers[peerIndex];
        if (!peer) {
            throw new Error(`Peer ${peerIndex} not found`);
        }

        const remoteRpc = peer.stateManager.p2pManager.remoteRpc;
        this.harness.context[`peer${peerIndex}OriginalBroadcast`] =
            remoteRpc.stateTransitionService.onBlockConfirmation;

        remoteRpc.stateTransitionService.onBlockConfirmation = (
            _blockConfirmation
        ) => {
            peer.logger.info("Suppressed broadcast from peer " + peerIndex);
            return {
                broadcast: () => {},
                sendOne: () => {},
                sendMultiple: () => {}
            } as any;
        };
    }

    /**
     * Submit a block with invalid transaction data that causes applyTransaction to fail
     */
    async submitInvalidTransactionDataBlock(
        peerIndex: number,
        options?: {
            forkId?: ForkId;
        }
    ): Promise<Block> {
        const peer = this.harness.getPeer(peerIndex);
        this.harness.contextApi.markMaliciousPeer({
            maliciousPeerIndex: peerIndex
        });
        const forkId = options?.forkId || this.harness.activeForkId!;

        const latestBlock =
            peer.stateManager.storage.blocks.getLatestBlock(forkId);
        if (!latestBlock) {
            throw new Error(`No block found for fork ${forkId}`);
        }

        const nextBlockHeight =
            peer.stateManager.storage.blocks.getNextBlockHeight(forkId);
        const previousBlockHash = this.harness.query.getPreviousBlockHash(
            peer,
            forkId,
            nextBlockHeight
        );

        // Create malformed transaction data that will cause applyTransaction to fail
        const malformedData = "0x1234567890abcdef"; // Invalid transaction data

        const transaction: TransactionStruct = {
            header: {
                channelId: peer.stateManager.getChannelId(),
                participant: peer.address,
                forkId: forkId,
                transactionCnt: BigInt(nextBlockHeight),
                timestamp: BigInt(latestBlock.timestamp) + 1n
            },
            body: {
                encodedData: malformedData as Bytes,
                data: malformedData as Bytes
            }
        };

        // Create a valid state snapshot hash (the fraud is in the transaction, not the state)
        const { success, encodedState } =
            await peer.stateManager.applyTransaction({
                ...transaction,
                body: {
                    encodedData:
                        peer.contractInstance.interface.encodeFunctionData(
                            "add",
                            [1]
                        ) as Bytes,
                    data: peer.contractInstance.interface.encodeFunctionData(
                        "add",
                        [1]
                    ) as Bytes
                }
            });

        if (!success) {
            throw new Error("Failed to compute valid state for fraud block");
        }

        const blockStruct: BlockStruct = {
            transaction: transaction, // Use the malformed transaction
            stateSnapshotHash: hash(encodedState), // But claim it produces this valid state
            previousBlockHash: previousBlockHash,
            messageBlocks: []
        };

        const invalidBlock = await Block.fromBlockStruct(
            blockStruct,
            peer.signer
        );

        this.logger.info(
            `Peer ${peerIndex} creating invalid transaction data block: height=${invalidBlock.height}`
        );

        // Broadcast the invalid block
        peer.p2pInstance.p2pSigner.p2pManager.remoteRpc.stateTransitionService
            .onBlockConfirmation(invalidBlock.blockConfirmationStruct)
            .broadcast();

        return invalidBlock;
    }

    /**
     * Submit a block with broken inbound message chain
     */
    async submitBrokenInboundChainBlock(
        peerIndex: number,
        options?: {
            forkId?: ForkId;
        }
    ): Promise<Block> {
        const peer = this.harness.getPeer(peerIndex);
        this.harness.contextApi.markMaliciousPeer({
            maliciousPeerIndex: peerIndex
        });
        const forkId = options?.forkId || this.harness.activeForkId!;

        const latestBlock =
            peer.stateManager.storage.blocks.getLatestBlock(forkId);
        if (!latestBlock) {
            throw new Error(`No block found for fork ${forkId}`);
        }

        const nextBlockHeight =
            peer.stateManager.storage.blocks.getNextBlockHeight(forkId);
        const previousBlockHash = this.harness.query.getPreviousBlockHash(
            peer,
            forkId,
            nextBlockHeight
        );

        // Create a valid transaction
        const contractInterface = peer.contractInstance.interface;
        const transactionData = contractInterface.encodeFunctionData("add", [
            1
        ]) as Bytes;

        const transaction: TransactionStruct = {
            header: {
                channelId: peer.stateManager.getChannelId(),
                participant: peer.address,
                forkId: forkId,
                transactionCnt: BigInt(nextBlockHeight),
                timestamp: BigInt(latestBlock.timestamp) + 1n
            },
            body: {
                encodedData: transactionData,
                data: transactionData
            }
        };

        // Create a fake message block with wrong previous hash to break the chain
        const brokenMessageBlock: MessageBlockStruct = {
            previousBlockHash: ethers.keccak256(
                ethers.toUtf8Bytes("fake_hash")
            ), // Wrong hash
            blockHeight: nextBlockHeight,
            messages: [],
            totalBalance: {
                amount: 0n,
                data: "0x"
            } as BalanceStruct,
            timestamp: BigInt(Date.now())
        };

        const blockStruct: BlockStruct = {
            transaction: transaction,
            stateSnapshotHash: ethers.ZeroHash as Hash, // Will be computed incorrectly due to broken chain
            previousBlockHash: previousBlockHash,
            messageBlocks: [brokenMessageBlock]
        };

        const invalidBlock = await Block.fromBlockStruct(
            blockStruct,
            peer.signer
        );

        this.logger.info(
            `Peer ${peerIndex} creating broken inbound chain block: height=${invalidBlock.height}`
        );

        // Broadcast the invalid block
        peer.p2pInstance.p2pSigner.p2pManager.remoteRpc.stateTransitionService
            .onBlockConfirmation(invalidBlock.blockConfirmationStruct)
            .broadcast();

        return invalidBlock;
    }

    /**
     * Submit a block at height 0 with a wrong previousBlockHash
     * Precondition:  maliciousPeerIndex must not be the peer who wrote
     * the original genesis block).
     */
    async submitWrongGenesisBlock(
        peerIndex: number,
        options?: {
            forkId?: ForkId;
        }
    ): Promise<Block> {
        const peer = this.harness.getPeer(peerIndex);
        this.harness.contextApi.markMaliciousPeer({
            maliciousPeerIndex: peerIndex
        });
        const forkId = options?.forkId || this.harness.activeForkId!;

        // Wrong previousBlockHash — not the real genesis snapshot hash.
        // This makes isLinked(block) return false, which combined with the
        // existing conflicting block at height 0 triggers wrongGenesisDetected.
        const wrongPreviousBlockHash = hash(
            ethers.toUtf8Bytes("wrong_genesis_hash")
        ) as Hash;

        const contractInterface = peer.contractInstance.interface;
        const transactionData = contractInterface.encodeFunctionData("add", [
            1
        ]) as Bytes;

        const transaction: TransactionStruct = {
            header: {
                channelId: peer.stateManager.getChannelId(),
                participant: peer.address,
                forkId,
                transactionCnt: 0n, // height 0
                timestamp: BigInt(Clock.getTimeInSeconds())
            },
            body: {
                encodedData: transactionData,
                data: transactionData
            }
        };

        const blockStruct: BlockStruct = {
            transaction,
            stateSnapshotHash: ZeroHash as Hash,
            previousBlockHash: wrongPreviousBlockHash,
            messageBlocks: []
        };

        const wrongGenesisBlock = await Block.fromBlockStruct(
            blockStruct,
            peer.signer
        );

        this.logger.info(
            `Peer ${peerIndex} broadcasting wrong genesis block: height=${wrongGenesisBlock.height}`,
            { forkId }
        );

        peer.p2pInstance.p2pSigner.p2pManager.remoteRpc.stateTransitionService
            .onBlockConfirmation(wrongGenesisBlock.blockConfirmationStruct)
            .broadcast();

        return wrongGenesisBlock;
    }

    /**
     * Submit a correctly-linked next block signed by a peer that is NOT the
     * expected next leader.
     * Precondition: peerIndex must NOT be the peer that getNextToWrite() returns

     */
    async submitUnexpectedNextLeaderBlock(
        peerIndex: number,
        options?: {
            forkId?: ForkId;
        }
    ): Promise<Block> {
        const peer = this.harness.getPeer(peerIndex);
        this.harness.contextApi.markMaliciousPeer({
            maliciousPeerIndex: peerIndex
        });
        const forkId = options?.forkId || this.harness.activeForkId!;

        const latestBlock =
            peer.stateManager.storage.blocks.getLatestBlock(forkId);
        if (!latestBlock) {
            throw new Error(`No block found for fork ${forkId}`);
        }

        const nextBlockHeight =
            peer.stateManager.storage.blocks.getNextBlockHeight(forkId);
        // Correct previousBlockHash so the block passes the isLinked check and
        // reaches the next-leader check in validateBlockConfirmation.
        const previousBlockHash = this.harness.query.getPreviousBlockHash(
            peer,
            forkId,
            nextBlockHeight
        );

        const contractInterface = peer.contractInstance.interface;
        const transactionData = contractInterface.encodeFunctionData("add", [
            1
        ]) as Bytes;

        const transaction: TransactionStruct = {
            header: {
                channelId: peer.stateManager.getChannelId(),
                participant: peer.address,
                forkId,
                transactionCnt: BigInt(nextBlockHeight),
                timestamp: BigInt(latestBlock.timestamp) + 1n
            },
            body: {
                encodedData: transactionData,
                data: transactionData
            }
        };

        const blockStruct: BlockStruct = {
            transaction,
            // stateSnapshotHash can be anything — invalidStateTransitionDetected
            // fires at the next-leader check, before any hash comparison.
            stateSnapshotHash: ZeroHash as Hash,
            previousBlockHash,
            messageBlocks: []
        };

        const block = await Block.fromBlockStruct(blockStruct, peer.signer);

        this.logger.info(
            `Peer ${peerIndex} submitting unexpected-next-leader block: height=${block.height}`,
            { forkId }
        );

        peer.p2pInstance.p2pSigner.p2pManager.remoteRpc.stateTransitionService
            .onBlockConfirmation(block.blockConfirmationStruct)
            .broadcast();

        return block;
    }

    /**
     * Submit a block with invalid timestamp (objectively invalid)
     */
    async submitInvalidTimestampBlock(
        peerIndex: number,
        options?: {
            forkId?: ForkId;
        }
    ): Promise<Block> {
        const peer = this.harness.getPeer(peerIndex);
        this.harness.contextApi.markMaliciousPeer({
            maliciousPeerIndex: peerIndex
        });
        const forkId = options?.forkId || this.harness.activeForkId!;

        const latestBlock =
            peer.stateManager.storage.blocks.getLatestBlock(forkId);
        if (!latestBlock) {
            throw new Error(`No block found for fork ${forkId}`);
        }

        const nextBlockHeight =
            peer.stateManager.storage.blocks.getNextBlockHeight(forkId);
        const previousBlockHash = this.harness.query.getPreviousBlockHash(
            peer,
            forkId,
            nextBlockHeight
        );

        // Create a valid transaction
        const contractInterface = peer.contractInstance.interface;
        const transactionData = contractInterface.encodeFunctionData("add", [
            1
        ]) as Bytes;

        // Create transaction with objectively invalid timestamp (in the past)
        const invalidTimestamp = BigInt(latestBlock.timestamp) - 1000n; // Timestamp before previous block

        const transaction: TransactionStruct = {
            header: {
                channelId: peer.stateManager.getChannelId(),
                participant: peer.address,
                forkId: forkId,
                transactionCnt: BigInt(nextBlockHeight),
                timestamp: invalidTimestamp // Invalid timestamp
            },
            body: {
                encodedData: transactionData,
                data: transactionData
            }
        };

        const blockStruct: BlockStruct = {
            transaction: transaction,
            stateSnapshotHash: ethers.ZeroHash as Hash,
            previousBlockHash: previousBlockHash,
            messageBlocks: []
        };

        const invalidBlock = await Block.fromBlockStruct(
            blockStruct,
            peer.signer
        );

        this.logger.info(
            `Peer ${peerIndex} creating invalid timestamp block: height=${invalidBlock.height}, timestamp=${invalidTimestamp}`
        );

        // Broadcast the invalid block
        peer.p2pInstance.p2pSigner.p2pManager.remoteRpc.stateTransitionService
            .onBlockConfirmation(invalidBlock.blockConfirmationStruct)
            .broadcast();

        return invalidBlock;
    }
}
