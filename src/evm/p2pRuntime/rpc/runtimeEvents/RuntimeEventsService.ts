import type {
    P2pRuntimeClientRoot,
    RuntimeEventSink
} from "../P2pRuntimeClientRoot";
import { RuntimeEventsRpcMethods } from "./RuntimeEventsRpcMethods";
import ARpcService from "@/rpc/ARpcService";
import type { RpcRouter } from "@/rpc/RpcRouter";
import type ATransport from "@/transport/ATransport";

/** the host's one-way traffic to the client: nothing here is answered */
export class RuntimeEventsService extends ARpcService<
    RuntimeEventsRpcMethods,
    RpcRouter<P2pRuntimeClientRoot, any>
> {
    constructor(
        router: RpcRouter<P2pRuntimeClientRoot, any>,
        readonly sink: RuntimeEventSink
    ) {
        super(router, router.logger);
    }

    createRPCMethods(transport: ATransport): RuntimeEventsRpcMethods {
        return new RuntimeEventsRpcMethods(transport, this);
    }
}

export default RuntimeEventsService;
