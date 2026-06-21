import ARpcService from "@/rpc/ARpcService";
import type P2PManager from "@/P2PManager";
import type ATransport from "@/transport/ATransport";
import type Block from "@/models/Block";
import { Codec, Type } from "@/utils";
import QueryRpcMethods, { type BlockBundle } from "./QueryRpcMethods";

/**
 * Read-only peer-state queries exposed to the test harness. Accessors live here
 * (not on the RpcMethods class) since every RpcMethods method is routable by
 * name at runtime.
 */
export class QueryService extends ARpcService<QueryRpcMethods> {
    constructor(p2pManager: P2PManager) {
        super(
            p2pManager,
            p2pManager.stateManager.logger.child({
                component: "HarnessQueryService"
            })
        );
    }

    get sm() {
        return this.p2pManager.stateManager;
    }
    get storage() {
        return this.sm.storage;
    }

    /** Project a live `Block` into a serializable bundle for the harness. */
    toBlockBundle(block: Block): BlockBundle {
        return {
            hash: String(block.hash),
            author: String(block.author),
            height: Number(block.height),
            encodedSignedBlock: Codec.encode(
                block.signedBlock,
                Type.SignedBlock
            ) as string,
            encodedBlockConfirmation: Codec.encode(
                block.blockConfirmationStruct,
                Type.BlockConfirmation
            ) as string,
            timestamp: Number(block.timestamp),
            onChainTimestamp:
                block.onChainTimestamp === undefined
                    ? null
                    : Number(block.onChainTimestamp),
            confirmationSignatures: [...block.confirmationSignatures].map(
                String
            )
        };
    }

    public createRPCMethods(transport: ATransport): QueryRpcMethods {
        return new QueryRpcMethods(transport, this);
    }
}

export default QueryService;
