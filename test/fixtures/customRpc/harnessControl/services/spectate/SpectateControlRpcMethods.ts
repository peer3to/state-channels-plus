// @spec-test-coverage-ignore: test-only spectate controls exercised by mapped targeted-channel cases
import type { SpectateControlService } from "./SpectateControlService";
import Block from "@/models/Block";
import ANetworkRpcMethods from "@/rpc/network/ANetworkRpcMethods";
import type NetworkTransport from "@/transport/NetworkTransport";
import type { Address, ChannelId, ForkId } from "@/types/types";
import { Codec, Type } from "@/utils";
import { ZeroHash } from "ethers";

/**
 * Spectator-flow endpoints, executed host-side. `SyncPayload` carries model
 * instances, so it crosses the port encoded (`Type.SyncPayload`) — the harness
 * decodes/inspects it on the main thread. Helpers/accessors are on
 * {@link SpectateControlService}.
 */
export class SpectateControlRpcMethods extends ANetworkRpcMethods<SpectateControlService> {
    constructor(transport: NetworkTransport, service: SpectateControlService) {
        super(transport, service);
    }

    public sync(peerAddress: Address, forkId: ForkId, blockHeight: number) {
        return this.service.spectate.sync(
            peerAddress,
            this.service.sm.channelId,
            forkId,
            blockHeight
        );
    }

    /** Generate a sync payload, returned encoded (or null if not provable). */
    public async generateSyncPayload(
        channelId: ChannelId,
        forkId: ForkId,
        blockHeight: number
    ): Promise<{ encodedSyncPayload: string } | null> {
        const payload = await this.service.spectate.generateSyncPayload(
            channelId,
            forkId,
            blockHeight
        );
        // `Codec.encode` returns an ABI hex string (serializable across the port).
        return payload
            ? {
                  encodedSyncPayload: Codec.encode(
                      payload,
                      Type.SyncPayload
                  ) as string
              }
            : null;
    }

    /**
     * Start a real local spectate sync toward `peerAddress`, targeting the
     * host peer's own channel. Fire-and-forget (as `SpectateService.sync`
     * is): returns once the request is launched — tests wait on observable
     * convergence / blacklist state, not this return.
     */
    public startSync(
        peerAddress: Address,
        forkId?: ForkId,
        blockHeight?: number,
        timeoutMs?: number
    ): boolean {
        const channelId = this.service.sm.channelId;
        if (channelId === ZeroHash) {
            throw new Error(
                "startSync - host peer has no channel; cannot start sync"
            );
        }
        // Omitted optionals cross the port as null; the service treats only
        // undefined as "not requested".
        void this.service.spectate.sync(
            peerAddress,
            channelId,
            forkId ?? undefined,
            blockHeight ?? undefined,
            timeoutMs ?? undefined
        );
        return true;
    }

    public async applySyncResponse(
        responderAddress: Address,
        forkId: ForkId,
        blockHeight: number,
        encodedSyncPayload: string
    ): Promise<boolean> {
        return this.service.spectate.applySyncResponse(
            String(responderAddress),
            this.service.buildSyncRequest(forkId, blockHeight),
            encodedSyncPayload
        );
    }

    /**
     * Persist an encoded sync payload; returns whether spectating aborted.
     * `prependedConfirmationValues` go in front of the first milestone's first
     * confirmation signatures after decode, so values that are not
     * ABI-encodable can be staged.
     */
    public async persistSyncPayload(
        encodedSyncPayload: string,
        prependedConfirmationValues?: string[]
    ): Promise<{ shouldAbort: boolean }> {
        const payload = Codec.decode(encodedSyncPayload, Type.SyncPayload);
        if (prependedConfirmationValues?.length) {
            const confirmation =
                payload.stateProof.milestones[0].blockConfirmations[0];
            payload.stateProof.milestones[0].blockConfirmations[0] = {
                signedBlock: confirmation.signedBlock,
                signatures: [
                    ...prependedConfirmationValues,
                    ...confirmation.signatures
                ]
            };
        }
        return this.service.spectate.persistSyncPayload(payload);
    }

    /** Run the live spectate multicall validation with encoded port-safe inputs. */
    public async tryMulticallSnapshotUpdate(
        encodedOnChainSnapshot: string,
        encodedSyncPayload: string
    ): Promise<boolean> {
        return await this.service.spectate.tryMulticallSnapshotUpdate(
            this.service.sm.channelId,
            Codec.decode(encodedOnChainSnapshot, Type.StateSnapshot),
            this.service.decodeSyncPayload(encodedSyncPayload),
            []
        );
    }

    /** Store a block straight into storage (`justPersist`); returns its hash. */
    public storeBlockJustPersist(encodedSignedBlock: string): string {
        const block = Block.fromSignedBlock(
            Codec.decode(encodedSignedBlock, Type.SignedBlock)
        );
        return String(
            this.service.sm.storage.blocks.storeBlock(block, {
                justPersist: true
            })
        );
    }
}

export default SpectateControlRpcMethods;
