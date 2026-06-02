import type {
    NetworkInterface,
    DisconnectFilterFn
} from "../interfaces/NetworkInterface";
import type { RestoreToken } from "../interfaces/common";
import type { PeerCaller } from "../../threaded/rpc/rpc-client";
import type { StubCallbackRegistry } from "../StubCallbackRegistry";

export class WorkerNetworkHandle implements NetworkInterface {
    private liveCallbackId: string | undefined;

    constructor(
        private readonly rpc: PeerCaller,
        private readonly registry: StubCallbackRegistry
    ) {}

    disconnectAll(): Promise<void> {
        return this.rpc.call("network.disconnectAll", {}) as Promise<void>;
    }
    tryOpenConnectionToChannel(channelId: string): Promise<void> {
        return this.rpc.call("network.tryOpenConnectionToChannel", {
            channelId
        }) as Promise<void>;
    }
    async installDisconnectFilter(
        filter: DisconnectFilterFn
    ): Promise<RestoreToken> {
        if (this.liveCallbackId) {
            this.registry.unregisterFilter(this.liveCallbackId);
        }
        const id = this.registry.registerFilter((msg) => filter(msg));
        this.liveCallbackId = id;
        return (await this.rpc.call("network.installDisconnectFilter", {
            callbackId: id
        })) as RestoreToken;
    }
    async restoreDisconnectFilter(): Promise<void> {
        if (this.liveCallbackId) {
            this.registry.unregisterFilter(this.liveCallbackId);
            this.liveCallbackId = undefined;
        }
        await this.rpc.call("network.restoreDisconnectFilter", {});
    }
}
