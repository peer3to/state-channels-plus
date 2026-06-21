import { ethers } from "ethers";

import ARpcService from "@/rpc/ARpcService";
import type P2PManager from "@/P2PManager";
import type ATransport from "@/transport/ATransport";
import type { ForkId, Hash } from "@/types/types";
import ByzantineRpcMethods from "./ByzantineRpcMethods";

/**
 * Byzantine block-submission faults exposed to the test harness.
 *
 * Shared state, accessors and helpers live here (not on the RpcMethods class):
 * every method on a `*RpcMethods` instance is routable by name at runtime, so
 * only the public endpoints belong there.
 */
export class ByzantineService extends ARpcService<ByzantineRpcMethods> {
    constructor(p2pManager: P2PManager) {
        super(
            p2pManager,
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

    public createRPCMethods(transport: ATransport): ByzantineRpcMethods {
        return new ByzantineRpcMethods(transport, this);
    }
}

export default ByzantineService;
