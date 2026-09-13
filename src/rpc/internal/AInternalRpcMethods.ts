import type { AInternalRpcService } from "./AInternalRpcService";
import type InternalTransport from "@/transport/InternalTransport";

export class AInternalRpcMethods<TService extends AInternalRpcService<any>> {
    constructor(
        public readonly service: TService,
        public readonly sender: InternalTransport
    ) {}
}
