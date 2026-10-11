import type ANetworkRpcMethods from "@/rpc/network/ANetworkRpcMethods";
import type ANetworkRpcService from "@/rpc/network/ANetworkRpcService";
import { AGuard } from "@/rpc/network/guards/AGuard";
import type Rpc from "@/rpc/Rpc";
import type NetworkTransport from "@/transport/NetworkTransport";
import { isEngagedStatus } from "@/types/flags";
import { DetachedPromises } from "@/utils/DetachedPromises";

/**
 * Retains live RPCs until the runtime is synced (SYNCED or a later active
 * status). A block a peer sends while the initial sync runs neither
 * advances state nor starts a second sync; once synced, each retained RPC
 * runs again through the whole guard chain in arrival order and then
 * through normal validation, so the peer never resends it. The initial
 * sync applies its own blocks through the ingest service, not this RPC
 * path. An abort drops what is retained.
 */
export class WaitForSyncStatusGuard extends AGuard<
    ANetworkRpcService<ANetworkRpcMethods>
> {
    private retained: { rpc: Rpc; transport: NetworkTransport }[] = [];
    private readonly retainedRpcs = new WeakSet<Rpc>();
    private unsubscribers: (() => void)[] = [];

    check(): boolean {
        return isEngagedStatus(this.service.p2pManager.stateManager.status);
    }

    onFailure(rpc: Rpc, transport: NetworkTransport): void {
        this.retained.push({ rpc, transport });
        this.retainedRpcs.add(rpc);
        if (this.unsubscribers.length) return;
        const events = this.service.p2pManager.stateManager.events;
        this.unsubscribers = [
            events.on("p2pEventHooks", "onStatusChanged", (_, status) => {
                if (isEngagedStatus(status)) this.release();
            }),
            events.on("p2pEventHooks", "onAbort", () => this.drop())
        ];
    }

    // Overrides AGuard.suppressesFailureResponse: a retained RPC is
    // answered when it runs after the sync.
    override suppressesFailureResponse(rpc: Rpc): boolean {
        return this.retainedRpcs.has(rpc);
    }

    private release(): void {
        for (const { rpc, transport } of this.drop())
            DetachedPromises.observe(
                this.service.runRPC(rpc, transport),
                (error) => {
                    throw error;
                }
            );
    }

    private drop(): { rpc: Rpc; transport: NetworkTransport }[] {
        for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe();
        return this.retained.splice(0);
    }
}
