// @spec-test-coverage-ignore: fixture support; executable evidence belongs to its calling test declarations.
import type {
    MirrorChainEvent,
    ObservableRead,
    MirrorReadFault,
    MirrorReadObservation,
    MirrorService,
    MirrorUpdate
} from "./MirrorService";
import ANetworkRpcMethods from "@/rpc/network/ANetworkRpcMethods";
import type NetworkTransport from "@/transport/NetworkTransport";

/**
 * Local mirror versus chain controls. Only public endpoints live here; the
 * patches and their state are on {@link MirrorService}.
 */
export class MirrorRpcMethods extends ANetworkRpcMethods<MirrorService> {
    constructor(transport: NetworkTransport, service: MirrorService) {
        super(transport, service);
    }

    public observeRead(read: ObservableRead): boolean {
        this.service.observe(read);
        return true;
    }

    public getReadObservation(read: ObservableRead): MirrorReadObservation {
        return this.service.observation(read);
    }

    public restoreRead(read: ObservableRead): boolean {
        this.service.restore(read);
        return true;
    }

    public failNextLocalRead(
        read: ObservableRead,
        fault: MirrorReadFault
    ): boolean {
        this.service.failNextLocalRead(read, fault);
        return true;
    }

    public failNextChainRead(
        read: ObservableRead,
        fault: MirrorReadFault
    ): boolean {
        this.service.failNextChainRead(read, fault);
        return true;
    }

    public serveChainReadsBefore(
        read: ObservableRead,
        event: MirrorChainEvent
    ): Promise<number> {
        return this.service.serveChainReadsBefore(read, event);
    }

    public holdUpdates(update: MirrorUpdate): boolean {
        this.service.holdUpdates(update);
        return true;
    }

    public getHeldUpdateCount(update: MirrorUpdate): number {
        return this.service.heldUpdateCount(update);
    }

    public releaseUpdates(update: MirrorUpdate): Promise<number> {
        return this.service.releaseUpdates(update);
    }
}

export default MirrorRpcMethods;
