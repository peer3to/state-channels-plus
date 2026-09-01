import ARpcService from "@/rpc/ARpcService";
import type PortRpcRouter from "@/rpc/PortRpcRouter";
import type ATransport from "@/transport/ATransport";
import type {
    P2pRuntimeClientRoot,
    RuntimeEventSink
} from "../P2pRuntimeClientRoot";
import { RuntimeEventsRpcMethods } from "./RuntimeEventsRpcMethods";

/** the host's one-way traffic to the client: nothing here is answered */
export class RuntimeEventsService extends ARpcService<
    RuntimeEventsRpcMethods,
    PortRpcRouter<P2pRuntimeClientRoot>
> {
    constructor(
        router: PortRpcRouter<P2pRuntimeClientRoot>,
        readonly sink: RuntimeEventSink
    ) {
        super(router, router.logger);
    }

    createRPCMethods(transport: ATransport): RuntimeEventsRpcMethods {
        return new RuntimeEventsRpcMethods(transport, this);
    }
}

export default RuntimeEventsService;
