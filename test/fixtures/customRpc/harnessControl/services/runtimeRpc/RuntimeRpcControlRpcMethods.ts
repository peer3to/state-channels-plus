// @spec-test-coverage-ignore: fixture support; executable evidence belongs to its calling test declarations.
import type {
    RuntimeConnectionKey,
    RuntimeRpcControlService
} from "./RuntimeRpcControlService";

import ANetworkRpcMethods from "@/rpc/network/ANetworkRpcMethods";
import type NetworkTransport from "@/transport/NetworkTransport";

export class RuntimeRpcControlRpcMethods extends ANetworkRpcMethods<RuntimeRpcControlService> {
    constructor(
        transport: NetworkTransport,
        service: RuntimeRpcControlService
    ) {
        super(transport, service);
    }
    public state(key: RuntimeConnectionKey) {
        return this.service.state(key);
    }
    public holdNextResponse(
        key: RuntimeConnectionKey,
        method: string
    ): boolean {
        void this.service.connection(key).control.holdNextResponse(method);
        return true;
    }
    public release(key: RuntimeConnectionKey, index?: number): boolean {
        const { control } = this.service.connection(key);
        if (index === undefined) control.release();
        else control.releaseAt(index);
        return true;
    }
    public failNextPost(key: RuntimeConnectionKey, method: string): void {
        this.service.connection(key).control.failNextPost(method);
    }
    public corruptNextParams(key: RuntimeConnectionKey, method: string): void {
        this.service.connection(key).control.corruptNextParams(method);
    }
    public close(key: RuntimeConnectionKey): void {
        this.service.connection(key).transport.close(true);
    }
}
