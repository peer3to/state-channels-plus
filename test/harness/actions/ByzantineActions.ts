import { ethers, Signer } from "ethers";
import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
import * as factory from "@test/factory";
import { Block } from "@/models";
import type { Address } from "@/types/types";
import type { BlockConfirmationStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import type { HarnessControlRpc } from "@test/fixtures/customRpc/harnessControl/HarnessControlRpc";
import { Codec, Logger, Type } from "@/utils";
import { ForkId, Bytes, BlockHeight } from "@/types/types";
import { BlockStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import {
    DisputeTampering,
    DisputeTamper,
    ConstructDisputeTamper
} from "@test/harness/actions/DisputeTamperingActions";
import { DisputeStruct } from "@typechain-types/contracts/V1/types/ProofTypes";

export class ByzantineActions<
    TCustomRpc extends HarnessControlRpc = HarnessControlRpc
> {
    constructor(
        protected harness: PeerTestHarness<TCustomRpc>,
        protected logger: Logger
    ) {}

    /**
     * Submit a double-signed block (two blocks at same height with different
     * content). The block is built, signed and broadcast host-side by the
     * Byzantine RPC service; `forkId` is omitted to let the host use its live
     * head fork unless a specific fork is requested.
     */
    async submitDoubleSignBlock(
        peerIndex: number,
        options?: {
            forkId?: ForkId;
            transactionData?: Bytes;
        }
    ): Promise<{
        conflictingBlockHash: string;
        conflictingBlockHeight: BlockHeight;
        originalBlockHash: string;
        originalBlockHeight: BlockHeight;
    }> {
        const peer = this.harness.getPeer(peerIndex);
        this.harness.contextApi.markMaliciousPeer({
            maliciousPeerIndex: peerIndex
        });

        const result = await this.harness
            .control(peer)
            .byzantine.submitDoubleSignBlock({
                forkId: options?.forkId,
                transactionData: options?.transactionData
            })
            .request();

        this.logger.info(`Double-sign block broadcasted by peer ${peerIndex}`);
        return result as {
            conflictingBlockHash: string;
            conflictingBlockHeight: BlockHeight;
            originalBlockHash: string;
            originalBlockHeight: BlockHeight;
        };
    }

    /**
     * Post junk calldata on-chain with an invalid signature (built and signed
     * host-side by the Byzantine RPC service).
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

        const { encodedBlock } = await this.harness
            .control(peer)
            .byzantine.postJunkCalldataOnChain({
                height: options.height,
                forkId: options.forkId,
                encodedData: options.encodedData
            })
            .request();

        this.logger.info(`Junk calldata posted on-chain by peer ${peerIndex}`);
        return Codec.decode(encodedBlock, Type.Block);
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
        tamperFn: ConstructDisputeTamper;
    }): Promise<void> {
        await this.harness.tamper.stubConstructDispute(
            options.peerIndex,
            options.tamperFn
        );
    }

    async restoreDisputeConstruction(peerIndex: number): Promise<void> {
        await this.harness.tamper.restoreConstructDispute(peerIndex);
    }

    async disconnect(peerIndex: number): Promise<void> {
        await this.harness.network.disconnectPeer(peerIndex);
    }

    async stubCalldataHandler(peerIndex: number): Promise<void> {
        const peer = this.harness.getPeer(peerIndex);
        await this.harness.control(peer).stub.stubCalldataPosting().request();
    }

    async restoreCalldataHandler(peerIndex: number): Promise<void> {
        const peer = this.harness.getPeer(peerIndex);
        await this.harness
            .control(peer)
            .stub.restoreCalldataPosting()
            .request();
    }

    /**
     * Make this peer omit pending inbound messages from authored blocks. Returns
     * an async teardown that restores the original behavior.
     */
    async stubPendingInboundInclusion(
        peerIndex: number
    ): Promise<() => Promise<void>> {
        const peer = this.harness.getPeer(peerIndex);
        await this.harness
            .control(peer)
            .stub.stubPendingInboundInclusion()
            .request();
        return async () => {
            await this.harness
                .control(peer)
                .stub.restorePendingInboundInclusion()
                .request();
        };
    }

    async stubBroadcast(peerIndex: number): Promise<void> {
        const peer = this.harness.getPeer(peerIndex);
        await this.harness.control(peer).stub.stubBroadcast().request();
    }

    /**
     * Craft an authentic height-0 block on a fork nobody has: real channel,
     * real participant author signature — the fork mismatch must be the only
     * reason a receiver treats it specially.
     */
    async craftBogusForkBlockZero(authorIndex: number): Promise<{
        bogusBlock: Block;
        blockConfirmation: BlockConfirmationStruct;
    }> {
        const author = this.harness.getPeer(authorIndex);
        const bogusBlock = factory.block({
            transaction: factory.transaction({
                header: factory.transactionHeader({
                    forkId: ethers.hexlify(ethers.randomBytes(32)),
                    transactionCnt: 0,
                    channelId: this.harness.channelId,
                    participant: author.address as Address
                })
            })
        });
        return {
            bogusBlock,
            blockConfirmation: {
                signedBlock: {
                    encodedBlock: bogusBlock.encode(),
                    signature: await author.signer.signMessage(
                        ethers.getBytes(bogusBlock.hash)
                    )
                },
                signatures: []
            }
        };
    }

    /**
     * Take a source peer's real latest block and re-sign it with a throwaway
     * outsider key: the block body is authentic, only the author signature is
     * forged, so authentication fails on the signature alone.
     */
    async craftJunkBlockConfirmation(
        sourcePeerIndex: number,
        forkId: ForkId
    ): Promise<{ encodedBlockConfirmation: string }> {
        const bundle = await this.harness
            .control(this.harness.getPeer(sourcePeerIndex))
            .query.getLatestBlockBundle(forkId)
            .request();
        const signedBlock = Codec.decode(
            bundle!.encodedSignedBlock,
            Type.SignedBlock
        );
        const outsider = ethers.Wallet.createRandom();
        const forgedSignature = await outsider.signMessage(
            ethers.getBytes(bundle!.hash)
        );
        return {
            encodedBlockConfirmation: Codec.encode(
                {
                    signedBlock: {
                        encodedBlock: signedBlock.encodedBlock,
                        signature: forgedSignature
                    },
                    signatures: []
                },
                Type.BlockConfirmation
            ) as string
        };
    }

    /**
     * Craft the next block (head height + 1) authored + signed by `author` - a
     * peer connected to the channel's p2p network but not a channel participant
     * (a spectator that never joined). A new block position, so it is validated
     * fresh rather than CRDT-merged into the head. Authentication passes (the
     * signature matches the declared author) but the author is not a participant,
     * and membership is checked before linkage -> reaches
     * blockAuthorIsNotParticipant (the connected-outsider DoS vector).
     */
    async craftOutsiderAuthoredBlockConfirmation(
        sourcePeerIndex: number,
        forkId: ForkId,
        author: Signer
    ): Promise<{ encodedBlockConfirmation: string }> {
        const bundle = await this.harness
            .control(this.harness.getPeer(sourcePeerIndex))
            .query.getLatestBlockBundle(forkId)
            .request();
        const head = Block.fromSignedBlock(
            Codec.decode(bundle!.encodedSignedBlock, Type.SignedBlock)
        );
        const authorAddress = (await author.getAddress()) as Address;
        const nextBlockStruct = {
            ...factory.blockStructWithTransactionHeader(head.blockStruct, {
                participant: authorAddress,
                transactionCnt: Number(head.height) + 1
            }),
            previousBlockHash: bundle!.hash
        };
        const outsiderSignedBlock = (
            await Block.fromBlockStruct(nextBlockStruct, author)
        ).signedBlock;
        return {
            encodedBlockConfirmation: Codec.encode(
                { signedBlock: outsiderSignedBlock, signatures: [] },
                Type.BlockConfirmation
            ) as string
        };
    }

    /**
     * Craft the next block authored + signed by `author`, but declaring the
     * state-snapshot hash of the block at `staleSnapshotHeight` instead of the
     * head's.
     */
    async craftStaleMembershipBlockConfirmation(
        sourcePeerIndex: number,
        forkId: ForkId,
        author: Signer,
        staleSnapshotHeight: BlockHeight
    ): Promise<{ encodedBlockConfirmation: string }> {
        const source = this.harness.control(
            this.harness.getPeer(sourcePeerIndex)
        );
        const headBundle = await source.query
            .getLatestBlockBundle(forkId)
            .request();
        const staleBundle = await source.query
            .getBlockByHeight(forkId, staleSnapshotHeight)
            .request();
        if (!headBundle) throw new Error("missing head block");
        if (!staleBundle)
            throw new Error(
                `missing block at stale height ${staleSnapshotHeight}`
            );

        const head = Block.fromSignedBlock(
            Codec.decode(headBundle.encodedSignedBlock, Type.SignedBlock)
        );
        const stale = Block.fromSignedBlock(
            Codec.decode(staleBundle.encodedSignedBlock, Type.SignedBlock)
        );
        const authorAddress = (await author.getAddress()) as Address;
        const nextBlockStruct = {
            ...factory.blockStructWithTransactionHeader(head.blockStruct, {
                participant: authorAddress,
                transactionCnt: Number(head.height) + 1
            }),
            previousBlockHash: headBundle.hash,
            // the lever: a snapshot whose participant set still contains `author`
            stateSnapshotHash: stale.stateSnapshotHash
        };
        const staleSignedBlock = (
            await Block.fromBlockStruct(nextBlockStruct, author)
        ).signedBlock;
        return {
            encodedBlockConfirmation: Codec.encode(
                { signedBlock: staleSignedBlock, signatures: [] },
                Type.BlockConfirmation
            ) as string
        };
    }
}
