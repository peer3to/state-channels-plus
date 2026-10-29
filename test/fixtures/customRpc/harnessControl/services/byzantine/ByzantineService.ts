// @spec-test-coverage-ignore: worker-side raw-RPC support for mapped lobby E2E declarations

import ByzantineRpcMethods from "./ByzantineRpcMethods";
import type P2PManager from "@/P2PManager";
import ANetworkRpcService from "@/rpc/network/ANetworkRpcService";
import type Rpc from "@/rpc/Rpc";
import type NetworkTransport from "@/transport/NetworkTransport";
import type { ForkId, Hash } from "@/types/types";
import { getChecksumAddress } from "@/utils";
import { errorMessage } from "@/utils/errorMessage";
import { ethers } from "ethers";

export type LobbyRawMethod = "advertise" | "pick" | "commit";
export type NegotiationRawMethod = "exchangeTerms" | "openProposal" | "abort";
/** How a raw request settled: the reply, or the rejection's message. */
export type RawRequestOutcome =
    | { ok: true; result: unknown }
    | { ok: false; error: string };

/**
 * Byzantine block-submission faults exposed to the test harness.
 *
 * Shared state, accessors and helpers live here (not on the RpcMethods class):
 * every method on a `*RpcMethods` instance is routable by name at runtime, so
 * only the public endpoints belong there.
 */
export class ByzantineService extends ANetworkRpcService<ByzantineRpcMethods> {
    constructor(p2pManager: P2PManager) {
        super(
            p2pManager.rpcRouter,
            p2pManager.stateManager.logger.child({
                component: "HarnessByzantineService"
            })
        );
    }

    get sm() {
        return this.p2pManager.stateManager;
    }
    get storage() {
        return this.sm.storage;
    }

    /** Head block hash for `forkId`, else the fork's genesis snapshot hash. */
    previousBlockHash(forkId: ForkId): Hash {
        const prevBlock = this.storage.blocks.getLatestBlock(forkId);
        return (prevBlock?.hash ??
            this.storage.stateSnapshots.getGenesisSnapshotByForkId(forkId)
                ?.hash ??
            ethers.ZeroHash) as Hash;
    }

    /** Head block's snapshot hash for `forkId`, else the genesis snapshot hash. */
    stateSnapshotHash(forkId: ForkId): Hash {
        const prevBlock = this.storage.blocks.getLatestBlock(forkId);
        return (prevBlock?.stateSnapshotHash ??
            this.storage.stateSnapshots.getGenesisSnapshotByForkId(forkId)
                ?.hash ??
            ethers.ZeroHash) as Hash;
    }

    public createRPCMethods(transport: NetworkTransport): ByzantineRpcMethods {
        return new ByzantineRpcMethods(transport, this);
    }

    public sendRawRpc(
        targetEvmAddress: string,
        service: "lobbyMatchingService" | "openChannelNegotiationService",
        method: LobbyRawMethod | NegotiationRawMethod,
        params: Rpc["params"]
    ): boolean {
        this.requireTransport(targetEvmAddress).send({
            service,
            method,
            params
        });
        return true;
    }

    /**
     * Sends a request for any service and method name over the real
     * transport, as a peer that names an endpoint its target may not serve;
     * resolves with how the request settled.
     */
    public async requestRawRpc(
        targetEvmAddress: string,
        service: string,
        method: string,
        params: Rpc["params"]
    ): Promise<RawRequestOutcome> {
        try {
            return {
                ok: true,
                result: await this.p2pManager.rpcRouter.sendRpcRequest(
                    { service, method, params },
                    this.requireTransport(targetEvmAddress)
                )
            };
        } catch (error) {
            return { ok: false, error: errorMessage(error) };
        }
    }

    private requireTransport(targetEvmAddress: string): NetworkTransport {
        const transport =
            this.p2pManager.profileManager.getTransportByEvmAddress(
                getChecksumAddress(targetEvmAddress)
            );
        if (!transport) throw new Error("Target peer is not connected");
        return transport;
    }
}

export default ByzantineService;
