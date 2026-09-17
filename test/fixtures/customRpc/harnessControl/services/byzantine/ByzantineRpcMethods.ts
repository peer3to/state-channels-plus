// @spec-test-coverage-ignore: authenticated raw-RPC controls exercised by mapped lobby E2E declarations

import type {
    ByzantineService,
    LobbyRawMethod,
    NegotiationRawMethod
} from "./ByzantineService";
import Clock from "@/Clock";
import Block from "@/models/Block";
import ANetworkRpcMethods from "@/rpc/network/ANetworkRpcMethods";
import type Rpc from "@/rpc/Rpc";
import type NetworkTransport from "@/transport/NetworkTransport";
import type { Bytes, ForkId, Hash, BlockHeight } from "@/types/types";
import { Codec, Type, hash } from "@/utils";
import type {
    BlockStruct,
    SignedBlockStruct,
    TransactionStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import { ethers } from "ethers";

/**
 * Byzantine block-submission faults, executed host-side. Only public endpoints
 * live here (every method is routable by name at runtime); shared accessors and
 * helpers are on {@link ByzantineService}.
 */
export class ByzantineRpcMethods extends ANetworkRpcMethods<ByzantineService> {
    constructor(transport: NetworkTransport, service: ByzantineService) {
        super(transport, service);
    }

    /**
     * Sign a harness-assembled block with this peer's signer and broadcast it as
     * a block confirmation. Block assembly (incl. app-specific calldata) stays
     * client-side; only signing/broadcast needs the host.
     */
    public async signAndBroadcastBlock(
        encodedBlock: string
    ): Promise<{ hash: string; height: number }> {
        const block = await Block.fromBlockStruct(
            Codec.decode(encodedBlock, Type.Block),
            this.service.sm.signer
        );
        this.p2pManager.remoteRpc.stateTransitionService
            .onBlockConfirmation(block.blockConfirmationStruct)
            .broadcast();
        return { hash: String(block.hash), height: Number(block.height) };
    }

    /**
     * Send a harness-crafted block confirmation as-is over the real
     * state-transition RPC. The receiver runs the actual src path, including
     * its transport-level side effects (disconnect/blacklist on rejection).
     */
    public async sendBlockConfirmation(
        encodedBlockConfirmation: string,
        targetEvmAddress: string
    ): Promise<boolean> {
        this.p2pManager.remoteRpc.stateTransitionService
            .onBlockConfirmation(
                Codec.decode(encodedBlockConfirmation, Type.BlockConfirmation)
            )
            .sendOne(targetEvmAddress);
        return true;
    }

    /**
     * Apply a transaction against the live state machine and return the
     * resulting state-snapshot hash, for building a block whose body is invalid
     * but whose declared snapshot hash is a real (valid) state.
     */
    public async applyTransactionStateHash(
        encodedTransaction: string
    ): Promise<{ success: boolean; stateSnapshotHash: string }> {
        const { success, encodedState } =
            await this.service.sm.snapshotAssemblyService["applyTransaction"](
                Codec.decode(encodedTransaction, Type.Transaction)
            );
        return { success, stateSnapshotHash: String(hash(encodedState)) };
    }

    /**
     * Re-sign this peer's latest authored block on `forkId` after changing only
     * its timestamp, then broadcast the resulting conflict.
     */
    public async submitDoubleSignBlock(options?: { forkId?: ForkId }): Promise<{
        conflictingBlockHash: Hash;
        conflictingBlockHeight: BlockHeight;
        originalBlockHash: Hash;
        originalBlockHeight: BlockHeight;
    }> {
        const forkId = (options?.forkId ?? this.service.sm.forkId) as ForkId;
        const originalBlock = Array.from(
            this.service.storage.blocks.getIterator(forkId)
        ).find((block) => block.author === this.service.sm.signerAddress);
        if (!originalBlock) {
            throw new Error(
                `No block authored by ${this.service.sm.signerAddress} found for fork ${forkId}`
            );
        }

        const conflictingBlockStruct: BlockStruct = {
            ...originalBlock.blockStruct,
            transaction: {
                ...originalBlock.blockStruct.transaction,
                header: {
                    ...originalBlock.blockStruct.transaction.header,
                    timestamp:
                        BigInt(
                            originalBlock.blockStruct.transaction.header
                                .timestamp
                        ) + 1n
                }
            }
        };

        const conflictingBlock = await Block.fromBlockStruct(
            conflictingBlockStruct,
            this.service.sm.signer
        );

        this.p2pManager.remoteRpc.stateTransitionService
            .onBlockConfirmation(conflictingBlock.blockConfirmationStruct)
            .broadcast();

        return {
            conflictingBlockHash: conflictingBlock.hash,
            conflictingBlockHeight: conflictingBlock.height,
            originalBlockHash: originalBlock.hash,
            originalBlockHeight: originalBlock.height
        };
    }

    /**
     * Post calldata on-chain with a deliberately invalid signature (the block
     * hash is double-hashed before signing). `authentic` signs the real hash
     * instead, so the junk transaction reaches state-transition validation.
     * `previousBlockHash` overrides the link to the head.
     */
    public async postJunkCalldataOnChain(options: {
        height: BlockHeight;
        forkId?: ForkId;
        encodedData?: Bytes;
        authentic?: boolean;
        previousBlockHash?: Hash;
    }): Promise<{ encodedBlock: string; encodedSignedBlock: string }> {
        const forkId = (options.forkId ?? this.service.sm.forkId) as ForkId;
        const height = options.height;

        const previousBlockHash =
            options.previousBlockHash ?? this.service.previousBlockHash(forkId);
        const stateSnapshotHash = this.service.stateSnapshotHash(forkId);
        const encodedData: Bytes =
            options.encodedData ??
            (ethers.hexlify(ethers.randomBytes(64)) as Bytes);

        const transaction: TransactionStruct = {
            header: {
                channelId: this.service.sm.channelId,
                participant: this.service.sm.signerAddress,
                forkId,
                transactionCnt: BigInt(height),
                timestamp: BigInt(Clock.getTimeInSeconds())
            },
            body: { encodedData, data: encodedData }
        };

        const blockStruct: BlockStruct = {
            transaction,
            stateSnapshotHash,
            previousBlockHash,
            messageBlocks: []
        };

        const encodedBlock = Codec.encode(blockStruct, Type.Block);
        const blockHash = hash(encodedBlock);
        const signedHash = options.authentic ? blockHash : hash(blockHash);
        const signature = await this.service.sm.signer.signMessage(
            ethers.getBytes(signedHash)
        );

        const signedBlock: SignedBlockStruct = {
            encodedBlock,
            signature
        };

        const maxTimestamp = Clock.getTimeInSeconds() + 1000;
        const tx =
            await this.service.sm.stateChannelManagerContract.postBlockCalldata(
                signedBlock,
                maxTimestamp
            );
        await tx.wait();

        return {
            encodedBlock: encodedBlock as string,
            encodedSignedBlock: Codec.encode(
                signedBlock,
                Type.SignedBlock
            ) as string
        };
    }

    public sendRawLobbyRpc(
        targetEvmAddress: string,
        method: LobbyRawMethod,
        params: Rpc["params"]
    ): boolean {
        return this.service.sendRawRpc(
            targetEvmAddress,
            "lobbyMatchingService",
            method,
            params
        );
    }

    public sendRawNegotiationRpc(
        targetEvmAddress: string,
        method: NegotiationRawMethod,
        params: Rpc["params"]
    ): boolean {
        return this.service.sendRawRpc(
            targetEvmAddress,
            "openChannelNegotiationService",
            method,
            params
        );
    }
}

export default ByzantineRpcMethods;
