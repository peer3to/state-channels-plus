import { invalidParams, type SubscribeResult } from "./blockStorageDiff";
import type { StorageDiffPeer } from "./PeerHub";
import {
    parseAddresses,
    parseBlockHash,
    parseBlockSelector,
    parseMinBlock,
    parseFromBlock,
    parseStateRequests
} from "./rpcParams";
import type {
    StorageDiffCatchUp,
    StorageDiffService,
    StorageDiffState
} from "./StorageDiffService";
import type {
    BlockEnvironment,
    RpcBlock
} from "../../storageDiff/storageDiffWire";

/**
 * The routable endpoints, one instance per connection. Requests reach methods
 * by name, so this class holds endpoints only; helpers and state belong on
 * `StorageDiffService`.
 */
export class StorageDiffRpcMethods {
    private readonly service: StorageDiffService;
    private readonly peer: StorageDiffPeer;

    constructor(service: StorageDiffService, peer: StorageDiffPeer) {
        this.service = service;
        this.peer = peer;
    }

    /** Pushes one record per canonical block, filtered to `addresses`. */
    async scp_subscribeContractStorage(
        params: unknown[]
    ): Promise<SubscribeResult> {
        if (params.length !== 1) throw invalidParams("Expected [addresses]");
        return await this.service.subscribe(
            this.peer,
            parseAddresses(params[0])
        );
    }

    /** Ends one of this connection's subscriptions; false for an unknown id. */
    async scp_unsubscribe(params: unknown[]): Promise<boolean> {
        if (params.length !== 1 || typeof params[0] !== "string") {
            throw invalidParams("Expected [subscriptionId]");
        }
        return this.service.unsubscribe(this.peer, params[0]);
    }

    /** The retained records from `fromBlock` to the head, filtered. */
    async scp_getContractStorageDiffs(
        params: unknown[]
    ): Promise<StorageDiffCatchUp> {
        if (params.length !== 2) {
            throw invalidParams("Expected [addresses, fromBlock]");
        }
        return await this.service.getDiffs(
            this.peer,
            parseAddresses(params[0]),
            parseFromBlock(params[1])
        );
    }

    /**
     * A retained block as the upstream returns it:
     * `["latest" | quantity | hash, full?, minBlock?]`; null when it is not
     * retained. With `minBlock` the answer waits for the head to reach it.
     */
    async scp_getBlock(params: unknown[]): Promise<RpcBlock | null> {
        if (params.length < 1 || params.length > 3) {
            throw invalidParams("Expected [block, full?, minBlock?]");
        }
        if (params[1] !== undefined && typeof params[1] !== "boolean") {
            throw invalidParams("full must be a boolean");
        }
        return await this.service.getBlock(
            parseBlockSelector(params[0]),
            params[1] === true,
            parseMinBlock(params[2])
        );
    }

    /** The environment of the best head, once it reaches `minBlock` if one is named. */
    async scp_getHead(params: unknown[]): Promise<BlockEnvironment> {
        if (params.length > 1) throw invalidParams("Expected [minBlock?]");
        return await this.service.getHead(parseMinBlock(params[0]));
    }

    /** A transaction of a retained block; null when none holds it. */
    async scp_getTransaction(params: unknown[]): Promise<unknown> {
        if (params.length < 1 || params.length > 2)
            throw invalidParams("Expected [hash, minBlock?]");
        return await this.service.getTransaction(
            parseBlockHash(params[0]),
            parseMinBlock(params[1])
        );
    }

    /** The receipt of a transaction of a retained block; null when none holds it. */
    async scp_getTransactionReceipt(params: unknown[]): Promise<unknown> {
        if (params.length < 1 || params.length > 2)
            throw invalidParams("Expected [hash, minBlock?]");
        return await this.service.getTransactionReceipt(
            parseBlockHash(params[0]),
            parseMinBlock(params[1])
        );
    }

    /**
     * Account and storage values at a retained block, from the service's
     * shared cache: `[blockHash, [{address, slots?, account?, code?}]]`.
     * `account` asks for balance and nonce. An unretained block fails with
     * code -32002.
     */
    async scp_getState(params: unknown[]): Promise<StorageDiffState> {
        if (params.length !== 2) {
            throw invalidParams("Expected [blockHash, accounts]");
        }
        return await this.service.getState(
            this.peer,
            parseBlockHash(params[0]),
            parseStateRequests(params[1])
        );
    }
}
