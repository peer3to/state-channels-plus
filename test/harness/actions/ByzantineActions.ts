import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
import { rejectClosureInWorkerMode } from "@test/harness/core/namedOpGuards";
import { Logger, Codec, Type } from "@/utils";
import { ForkId, Bytes, Hash, BlockHeight } from "@/types/types";
import Block from "@/models/Block";
import {
    BlockStruct,
    TransactionStruct,
    SignedBlockStruct,
    BlockConfirmationStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import { ethers } from "ethers";
import Clock from "@/Clock";
import { hash } from "@/utils";
import {
    DisputeTampering,
    DisputeTamper
} from "@test/harness/actions/DisputeTamperingActions";
import { DisputeStruct } from "@typechain-types/contracts/V1/types/ProofTypes";

export class ByzantineActions {
    constructor(
        protected harness: PeerTestHarness,
        protected logger: Logger
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
        const peerHandle = this.harness.getPeerHandle(peerIndex);
        this.harness.contextApi.markMaliciousPeer({
            maliciousPeerIndex: peerIndex
        });
        const forkId = options?.forkId || this.harness.activeForkId!;

        this.logger.debug(
            `Peer ${peerIndex} creating double-sign block for fork ${forkId}`
        );

        const blockConfirmation =
            await peerHandle.queryLatestBlockConfirmation(forkId);
        if (!blockConfirmation) {
            throw new Error(`No block found for fork ${forkId}`);
        }
        const originalBlock = Block.fromBlockConfirmation(
            blockConfirmation as BlockConfirmationStruct
        );

        this.logger.debug(
            `Original block found: height=${originalBlock.height}, hash=${originalBlock.hash}`
        );

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
            peerHandle.signer
        );

        this.logger.info(
            `Peer ${peerIndex} broadcasting double-sign block: height=${conflictingBlock.height}, hash=${conflictingBlock.hash}`
        );

        await peerHandle.byzantine.submitDoubleSignBlock(
            conflictingBlock.blockConfirmationStruct
        );

        this.logger.info(`Double-sign block broadcasted by peer ${peerIndex}`);

        return {
            conflictingBlock,
            originalBlock
        };
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
        const peerHandle = this.harness.getPeerHandle(peerIndex);
        this.harness.contextApi.markMaliciousPeer({
            maliciousPeerIndex: peerIndex
        });
        const forkId = options.forkId || this.harness.activeForkId!;
        const height = options.height;

        void peer; // unused once query.* migrated
        const previousBlockHash = await peerHandle.queryPreviousBlockHash({
            forkId
        });
        const stateSnapshotHash =
            await peerHandle.queryStateSnapshotHashForFork({
                forkId,
                previousBlockHash
            });

        const encodedData: Bytes =
            options.encodedData ||
            (ethers.hexlify(ethers.randomBytes(64)) as Bytes);

        const transaction: TransactionStruct = {
            header: {
                channelId: this.harness.channelId,
                participant: peerHandle.address,
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

        // Corrupt the hash so the on-chain signature is invalid.
        const encodedBlock = Codec.encode(blockStruct, Type.Block);
        const blockHash = hash(encodedBlock);
        const corruptedBlockHash = hash(blockHash);
        const invalidSignature = await peerHandle.signer.signMessage(
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

        // On-chain write stays orchestrator-side via harness.channelManager.
        const channelManager = this.harness.channelManager.connect(
            peerHandle.signer
        );
        const tx = await channelManager.postBlockCalldata(
            signedBlock,
            maxTimestamp
        );
        await tx.wait();

        this.logger.info(`Junk calldata posted on-chain by peer ${peerIndex}`);

        return blockStruct;
    }

    async postTamperedDisputeWith(
        peerIndex: number,
        tamperFn: DisputeTamper
    ): Promise<DisputeStruct> {
        rejectClosureInWorkerMode(
            "ByzantineActions.postTamperedDisputeWith(tamperFn)",
            this.harness.getPeerHandle(peerIndex)
        );
        const forkId = this.harness.activeForkId;
        if (!forkId) {
            throw new Error("No active fork ID - channel must be opened first");
        }

        const { dispute } = await this.harness.tamper.postTamperedDispute(
            peerIndex,
            tamperFn,
            { forkId }
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

    async stubDisputeConstruction(options: {
        peerIndex: number;
        tamperFn: DisputeTamper;
    }): Promise<void> {
        rejectClosureInWorkerMode(
            "ByzantineActions.stubDisputeConstruction(tamperFn)",
            this.harness.getPeerHandle(options.peerIndex)
        );
        await this.harness.tamper.stubConstructDispute(
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

    async stubCalldataHandler(peerIndex: number): Promise<void> {
        await this.harness
            .getPeerHandle(peerIndex)
            .byzantine.stubCalldataHandler();
    }

    async restoreCalldataHandler(peerIndex: number): Promise<void> {
        await this.harness
            .getPeerHandle(peerIndex)
            .byzantine.restoreCalldataHandler();
    }

    async stubPendingInboundInclusion(
        peerIndex: number
    ): Promise<() => Promise<void>> {
        const handle = this.harness.getPeerHandle(peerIndex);
        await handle.byzantine.stubPendingInboundInclusion();
        return async () => {
            await handle.byzantine.restorePendingInboundInclusion();
        };
    }

    async stubBroadcast(peerIndex: number): Promise<void> {
        await this.harness.getPeerHandle(peerIndex).byzantine.stubBroadcast();
    }
}
