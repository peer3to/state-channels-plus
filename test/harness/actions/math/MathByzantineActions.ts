import { ethers, ZeroHash } from "ethers";

import type { Logger } from "@/utils";
import { ByzantineActions } from "@test/harness/actions/ByzantineActions";
import type { ForgeSubmitterSnapshotMutate } from "@test/harness/actions/DisputeTamperingActions";
import type { TestPeer } from "@test/harness/core/types";
import type MathPeerTestHarness from "@test/fixtures/MathPeerTestHarness";
import { ForkId, Bytes, Hash } from "@/types/types";
import Block from "@/models/Block";
import Clock from "@/Clock";
import { hash } from "@/utils";
import type { MathStateMachine } from "@typechain-types";
import {
    BlockStruct,
    TransactionStruct,
    MessageBlockStruct,
    MessageStruct,
    BalanceStruct
} from "@typechain-types/contracts/V1/types/DataTypes";

export class MathByzantineActions extends ByzantineActions {
    protected override harness!: MathPeerTestHarness;

    constructor(harness: MathPeerTestHarness, logger: Logger) {
        super(harness, logger);
    }

    // Worker peers lack contractInstance; encode calldata via the factory locally.
    private encodeMathAdd(_peer?: TestPeer, value: number = 1): Bytes {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { MathStateMachine__factory } = require("@typechain-types");
        return (
            MathStateMachine__factory as {
                createInterface: () => {
                    encodeFunctionData: (
                        name: string,
                        args: unknown[]
                    ) => string;
                };
            }
        )
            .createInterface()
            .encodeFunctionData("add", [value]) as Bytes;
    }

    async submitInvalidStateTransitionBlock(
        peerIndex: number,
        options?: {
            forkId?: ForkId;
            transactionData?: Bytes;
            wrongStateSnapshotHash?: Hash;
        }
    ): Promise<Block> {
        const handle = this.harness.getPeerHandle(peerIndex);
        this.harness.contextApi.markMaliciousPeer({
            maliciousPeerIndex: peerIndex
        });
        const forkId = options?.forkId || this.harness.activeForkId!;

        this.logger.debug(
            `Peer ${peerIndex} creating invalid state transition block for fork ${forkId}`
        );

        const latestBlock = (await handle.blocks.queryLatestBlock(forkId))!;

        const nextBlockHeight =
            await handle.blocks.queryNextBlockHeight(forkId);
        const previousBlockHash = await handle.blocks.queryPreviousBlockHash({
            forkId,
            height: nextBlockHeight
        });

        const transactionData =
            options?.transactionData ?? this.encodeMathAdd();

        const transaction: TransactionStruct = {
            header: {
                channelId: this.harness.channelId,
                participant: handle.address,
                forkId,
                transactionCnt: BigInt(nextBlockHeight),
                timestamp: BigInt(latestBlock.timestamp) + 1n
            },
            body: {
                encodedData: transactionData,
                data: transactionData
            }
        };

        const wrongStateSnapshotHash =
            options?.wrongStateSnapshotHash || (ZeroHash as Hash);

        const blockStruct: BlockStruct = {
            transaction,
            stateSnapshotHash: wrongStateSnapshotHash,
            previousBlockHash,
            messageBlocks: []
        };

        const invalidBlock = await Block.fromBlockStruct(
            blockStruct,
            handle.signer
        );

        this.logger.info(
            `Peer ${peerIndex} creating invalid state transition block: height=${invalidBlock.height}, hash=${invalidBlock.hash}, wrongStateSnapshotHash=${wrongStateSnapshotHash}`
        );

        await handle.byzantine.broadcastBlockConfirmation(
            invalidBlock.blockConfirmationStruct
        );

        this.logger.info(
            `Invalid state transition block broadcasted by peer ${peerIndex}`
        );

        return invalidBlock;
    }

    async submitForgedInboundMessageBlock(
        peerIndex: number,
        options?: {
            forkId?: ForkId;
        }
    ): Promise<Block> {
        const handle = this.harness.getPeerHandle(peerIndex);
        this.harness.contextApi.markMaliciousPeer({
            maliciousPeerIndex: peerIndex
        });
        const forkId = options?.forkId || this.harness.activeForkId!;

        const nextBlockHeight =
            await handle.blocks.queryNextBlockHeight(forkId);
        const previousBlock = await handle.blocks.queryLatestBlock(forkId);
        const previousBlockHash = await handle.blocks.queryPreviousBlockHash({
            forkId,
            height: nextBlockHeight
        });
        const stateSnapshotHash =
            await handle.snapshots.queryStateSnapshotHashForFork({
                forkId,
                previousBlockHash: previousBlock?.hash
                    ? String(previousBlock.hash)
                    : undefined
            });

        const previousStateSnapshot =
            (await handle.snapshots.queryPreviousStateSnapshot({
                forkId,
                height: nextBlockHeight
            })) as {
                snapshotData: {
                    latestInboundMessageBlockHash?: Hash;
                    latestInboundMessageBlockHeight?: bigint | number;
                };
            } | null;
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
            participant: handle.address,
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

        const transactionData = this.encodeMathAdd();

        const blockTimestampBase = previousBlock
            ? previousBlock.timestamp + 1
            : Clock.getTimeInSeconds();

        const transaction: TransactionStruct = {
            header: {
                channelId: this.harness.channelId,
                participant: handle.address,
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
            handle.signer
        );

        this.logger.info(
            `Peer ${peerIndex} broadcasting forged inbound message block at height ${forgedBlock.height}`,
            { forkId }
        );

        await handle.byzantine.broadcastBlockConfirmation(
            forgedBlock.blockConfirmationStruct
        );

        return forgedBlock;
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

    async submitInvalidTransactionDataBlock(
        peerIndex: number,
        options?: {
            forkId?: ForkId;
        }
    ): Promise<Block> {
        const handle = this.harness.getPeerHandle(peerIndex);
        this.harness.contextApi.markMaliciousPeer({
            maliciousPeerIndex: peerIndex
        });
        const forkId = options?.forkId || this.harness.activeForkId!;

        const latestBlock = (await handle.blocks.queryLatestBlock(forkId))!;

        const nextBlockHeight =
            await handle.blocks.queryNextBlockHeight(forkId);
        const previousBlockHash = await handle.blocks.queryPreviousBlockHash({
            forkId,
            height: nextBlockHeight
        });

        const malformedData = "0x1234567890abcdef";

        const transaction: TransactionStruct = {
            header: {
                channelId: this.harness.channelId,
                participant: handle.address,
                forkId,
                transactionCnt: BigInt(nextBlockHeight),
                timestamp: BigInt(latestBlock.timestamp) + 1n
            },
            body: {
                encodedData: malformedData as Bytes,
                data: malformedData as Bytes
            }
        };

        const validEncodedData = this.encodeMathAdd();
        const { success, encodedState } =
            (await handle.stateMachine.applyTransaction({
                ...transaction,
                body: {
                    encodedData: validEncodedData,
                    data: validEncodedData
                }
            })) as { success: boolean; encodedState: string };

        if (!success) {
            throw new Error("Failed to compute valid state for fraud block");
        }

        const blockStruct: BlockStruct = {
            transaction,
            stateSnapshotHash: hash(encodedState),
            previousBlockHash,
            messageBlocks: []
        };

        const invalidBlock = await Block.fromBlockStruct(
            blockStruct,
            handle.signer
        );

        this.logger.info(
            `Peer ${peerIndex} creating invalid transaction data block: height=${invalidBlock.height}`
        );

        await handle.byzantine.broadcastBlockConfirmation(
            invalidBlock.blockConfirmationStruct
        );

        return invalidBlock;
    }

    async submitBrokenInboundChainBlock(
        peerIndex: number,
        options?: {
            forkId?: ForkId;
        }
    ): Promise<Block> {
        const handle = this.harness.getPeerHandle(peerIndex);
        this.harness.contextApi.markMaliciousPeer({
            maliciousPeerIndex: peerIndex
        });
        const forkId = options?.forkId || this.harness.activeForkId!;

        const latestBlock = (await handle.blocks.queryLatestBlock(forkId))!;

        const nextBlockHeight =
            await handle.blocks.queryNextBlockHeight(forkId);
        const previousBlockHash = await handle.blocks.queryPreviousBlockHash({
            forkId,
            height: nextBlockHeight
        });

        const transactionData = this.encodeMathAdd();

        const transaction: TransactionStruct = {
            header: {
                channelId: this.harness.channelId,
                participant: handle.address,
                forkId,
                transactionCnt: BigInt(nextBlockHeight),
                timestamp: BigInt(latestBlock.timestamp) + 1n
            },
            body: {
                encodedData: transactionData,
                data: transactionData
            }
        };

        const brokenMessageBlock: MessageBlockStruct = {
            previousBlockHash: ethers.keccak256(
                ethers.toUtf8Bytes("fake_hash")
            ),
            blockHeight: nextBlockHeight,
            messages: [],
            totalBalance: {
                amount: 0n,
                data: "0x"
            } as BalanceStruct,
            timestamp: BigInt(Date.now())
        };

        const blockStruct: BlockStruct = {
            transaction,
            stateSnapshotHash: ethers.ZeroHash as Hash,
            previousBlockHash,
            messageBlocks: [brokenMessageBlock]
        };

        const invalidBlock = await Block.fromBlockStruct(
            blockStruct,
            handle.signer
        );

        this.logger.info(
            `Peer ${peerIndex} creating broken inbound chain block: height=${invalidBlock.height}`
        );

        await handle.byzantine.broadcastBlockConfirmation(
            invalidBlock.blockConfirmationStruct
        );

        return invalidBlock;
    }

    async submitWrongGenesisBlock(
        peerIndex: number,
        options?: {
            forkId?: ForkId;
        }
    ): Promise<Block> {
        const handle = this.harness.getPeerHandle(peerIndex);
        this.harness.contextApi.markMaliciousPeer({
            maliciousPeerIndex: peerIndex
        });
        const forkId = options?.forkId || this.harness.activeForkId!;

        const wrongPreviousBlockHash = hash(
            ethers.toUtf8Bytes("wrong_genesis_hash")
        ) as Hash;

        const transactionData = this.encodeMathAdd();

        const transaction: TransactionStruct = {
            header: {
                channelId: this.harness.channelId,
                participant: handle.address,
                forkId,
                transactionCnt: 0n,
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
            handle.signer
        );

        this.logger.info(
            `Peer ${peerIndex} broadcasting wrong genesis block: height=${wrongGenesisBlock.height}`,
            { forkId }
        );

        await handle.byzantine.broadcastBlockConfirmation(
            wrongGenesisBlock.blockConfirmationStruct
        );

        return wrongGenesisBlock;
    }

    async submitUnexpectedNextLeaderBlock(
        peerIndex: number,
        options?: {
            forkId?: ForkId;
        }
    ): Promise<Block> {
        const handle = this.harness.getPeerHandle(peerIndex);
        this.harness.contextApi.markMaliciousPeer({
            maliciousPeerIndex: peerIndex
        });
        const forkId = options?.forkId || this.harness.activeForkId!;

        const latestBlock = (await handle.blocks.queryLatestBlock(forkId))!;

        const nextBlockHeight =
            await handle.blocks.queryNextBlockHeight(forkId);
        const previousBlockHash = await handle.blocks.queryPreviousBlockHash({
            forkId,
            height: nextBlockHeight
        });

        const transactionData = this.encodeMathAdd();

        const transaction: TransactionStruct = {
            header: {
                channelId: this.harness.channelId,
                participant: handle.address,
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
            stateSnapshotHash: ZeroHash as Hash,
            previousBlockHash,
            messageBlocks: []
        };

        const block = await Block.fromBlockStruct(blockStruct, handle.signer);

        this.logger.info(
            `Peer ${peerIndex} submitting unexpected-next-leader block: height=${block.height}`,
            { forkId }
        );

        await handle.byzantine.broadcastBlockConfirmation(
            block.blockConfirmationStruct
        );

        return block;
    }

    async submitInvalidTimestampBlock(
        peerIndex: number,
        options?: {
            forkId?: ForkId;
        }
    ): Promise<Block> {
        const handle = this.harness.getPeerHandle(peerIndex);
        this.harness.contextApi.markMaliciousPeer({
            maliciousPeerIndex: peerIndex
        });
        const forkId = options?.forkId || this.harness.activeForkId!;

        const latestBlock = (await handle.blocks.queryLatestBlock(forkId))!;

        const nextBlockHeight =
            await handle.blocks.queryNextBlockHeight(forkId);
        const previousBlockHash = await handle.blocks.queryPreviousBlockHash({
            forkId,
            height: nextBlockHeight
        });

        const transactionData = this.encodeMathAdd();
        const invalidTimestamp = BigInt(latestBlock.timestamp) - 1000n;

        const transaction: TransactionStruct = {
            header: {
                channelId: this.harness.channelId,
                participant: handle.address,
                forkId,
                transactionCnt: BigInt(nextBlockHeight),
                timestamp: invalidTimestamp
            },
            body: {
                encodedData: transactionData,
                data: transactionData
            }
        };

        const blockStruct: BlockStruct = {
            transaction,
            stateSnapshotHash: ethers.ZeroHash as Hash,
            previousBlockHash,
            messageBlocks: []
        };

        const invalidBlock = await Block.fromBlockStruct(
            blockStruct,
            handle.signer
        );

        this.logger.info(
            `Peer ${peerIndex} creating invalid timestamp block: height=${invalidBlock.height}, timestamp=${invalidTimestamp}`
        );

        await handle.byzantine.broadcastBlockConfirmation(
            invalidBlock.blockConfirmationStruct
        );

        return invalidBlock;
    }

    async postFraudulentSnapshot(options: {
        mutate: ForgeSubmitterSnapshotMutate;
        poster?: number;
    }): Promise<void> {
        const poster = options.poster ?? 0;

        const forgedSnapshot = await this.harness.tamper.buildForgedSnapshot(
            poster,
            options.mutate
        );

        const outboundBlocks: MessageBlockStruct[] = forgedSnapshot.mutated
            .outboundMessageBlock
            ? [forgedSnapshot.mutated.outboundMessageBlock]
            : [];

        const submitter = this.harness.getPeerHandle(poster);
        const channelManager = this.harness.channelManager.connect(
            submitter.signer
        );
        const callData = channelManager.interface.encodeFunctionData(
            "updateStateSnapshotSameFork",
            [
                this.harness.channelId,
                [
                    {
                        blockConfirmations: [
                            forgedSnapshot.forgedBlock.blockConfirmationStruct
                        ]
                    }
                ],
                [forgedSnapshot.forgedSnapshot.toStruct()],
                outboundBlocks
            ]
        );
        // store forged snapshot in all peers before mining so on-chain
        // StateSnapshotUpdated events don't fatal on unknown-snapshot lookup
        const snapshotStruct = forgedSnapshot.forgedSnapshot.toStruct();
        await Promise.all(
            this.harness.peerHandles.map((p) =>
                p.byzantine.storeStateSnapshot(snapshotStruct)
            )
        );

        const tx = await channelManager.multicall([callData]);
        await tx.wait();
    }
}
