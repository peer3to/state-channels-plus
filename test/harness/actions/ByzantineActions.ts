import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
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
     * Suppress this peer's pending-inbound-inclusion reporting. Returns an async
     * teardown that restores the original behavior.
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
}
