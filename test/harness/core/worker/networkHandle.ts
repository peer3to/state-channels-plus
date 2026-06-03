import type {
    NetworkInterface,
    DisconnectFilterFn
} from "../interfaces/NetworkInterface";
import type { RestoreToken } from "../interfaces/common";
import type { PeerCaller } from "../../threaded/rpc/PeerCaller";
import type { StubCallbackRegistry } from "../StubCallbackRegistry";
import { ChannelId } from "@/types";
import { ROUTES } from "@test/harness/threaded/worker/routeNames";

export class WorkerNetworkHandle implements NetworkInterface {
    private liveCallbackId: string | undefined;

    constructor(
        private readonly rpc: PeerCaller,
        private readonly registry: StubCallbackRegistry
    ) {}

    disconnectAll(): Promise<void> {
        return this.rpc.call(ROUTES.network.disconnectAll, {}) as Promise<void>;
    }
    tryOpenConnectionToChannel(channelId: ChannelId): Promise<void> {
        return this.rpc.call(ROUTES.network.tryOpenConnectionToChannel, {
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
        return (await this.rpc.call(ROUTES.network.installDisconnectFilter, {
            callbackId: id
        })) as RestoreToken;
    }
}
