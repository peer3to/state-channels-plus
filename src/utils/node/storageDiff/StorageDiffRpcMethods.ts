import {
    invalidParams,
    parseAddresses,
    parseFromBlock,
    type BlockStorageDiff,
    type SubscriptionId
} from "./blockStorageDiff";
import type { StorageDiffPeer, StorageDiffService } from "./StorageDiffService";

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
    ): Promise<SubscriptionId> {
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
    ): Promise<BlockStorageDiff[]> {
        if (params.length !== 2) {
            throw invalidParams("Expected [addresses, fromBlock]");
        }
        return await this.service.getDiffs(
            parseAddresses(params[0]),
            parseFromBlock(params[1])
        );
    }
}
