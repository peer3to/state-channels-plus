import { SdkClientRpcMethods } from "./SdkClientRpcMethods";
import { AInternalRpcService } from "@/rpc/internal/AInternalRpcService";
import type { InternalRpcRouter } from "@/rpc/router/InternalRpcRouter";
import type InternalTransport from "@/transport/InternalTransport";

export type SdkClientHandlers = {
    [K in keyof SdkClientRpcMethods as SdkClientRpcMethods[K] extends (
        ...args: any[]
    ) => unknown
        ? K
        : never]: SdkClientRpcMethods[K];
};

export class SdkClientService extends AInternalRpcService<SdkClientRpcMethods> {
    constructor(
        router: InternalRpcRouter,
        public readonly handlers: SdkClientHandlers
    ) {
        super(router);
    }
    public createRPCMethods(sender: InternalTransport) {
        return new SdkClientRpcMethods(this, sender);
    }
}
