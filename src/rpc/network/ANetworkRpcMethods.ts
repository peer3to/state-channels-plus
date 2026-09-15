import type ANetworkRpcService from "./ANetworkRpcService";
import { NetworkTransport } from "@/transport";

abstract class ANetworkRpcMethods<
    TService extends ANetworkRpcService<any, any> = ANetworkRpcService<any>
> {
    constructor(
        public readonly senderTransport: NetworkTransport,
        public readonly service: TService
    ) {}

    get p2pManager(): TService["p2pManager"] {
        return this.service.p2pManager;
    }

    get remoteRpc(): TService["p2pManager"]["remoteRpc"] {
        return this.service.remoteRpc;
    }
}

export default ANetworkRpcMethods;
