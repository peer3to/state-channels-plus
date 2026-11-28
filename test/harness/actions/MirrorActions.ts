// @spec-test-coverage-ignore: fixture support; executable evidence belongs to its calling test declarations.
import type { P2pRuntimeHostRoot } from "@/rpc/internal/roots/P2pRuntimeHostRoot";
import type {
    HarnessControlRpc,
    HarnessControlRpcShape
} from "@test/fixtures/customRpc/harnessControl/HarnessControlRpc";
import type {
    MirrorChainEvent,
    ObservableRead,
    MirrorReadFault,
    MirrorReadObservation
} from "@test/fixtures/customRpc/harnessControl/services/mirror/MirrorService";
import type { PeerTestHarness } from "@test/fixtures/PeerTestHarness";

/**
 * Local mirror versus chain staging for the local-first reads (see
 * `MirrorService`). Observation is record-only; every read still reaches the
 * real contract.
 */
export class MirrorActions<
    THost extends
        P2pRuntimeHostRoot<HarnessControlRpcShape> = P2pRuntimeHostRoot<HarnessControlRpc>
> {
    constructor(private harness: PeerTestHarness<THost>) {}

    private mirror(peerIndex: number) {
        return this.harness.control(this.harness.getPeer(peerIndex)).mirror;
    }

    /** Count and record the peer's local and chain `read` calls. */
    async observe(
        peerIndex: number,
        read: ObservableRead
    ): Promise<{
        observation: () => Promise<MirrorReadObservation>;
        restore: () => Promise<void>;
    }> {
        const mirror = () => this.mirror(peerIndex);
        await mirror().observeRead(read).request();
        return {
            observation: async () =>
                await mirror().getReadObservation(read).request(),
            restore: async () => {
                await mirror().restoreRead(read).request();
            }
        };
    }

    /** The next chain `read` fails (observed reads only). */
    async failNextChainRead(
        peerIndex: number,
        read: ObservableRead,
        fault: MirrorReadFault
    ): Promise<void> {
        await this.mirror(peerIndex).failNextChainRead(read, fault).request();
    }

    /**
     * Serve the peer's chain `read` calls from the chain state one block
     * before the channel's latest `event` log. Returns that block.
     */
    async serveChainReadsBefore(
        peerIndex: number,
        read: ObservableRead,
        event: MirrorChainEvent
    ): Promise<number> {
        return await this.mirror(peerIndex)
            .serveChainReadsBefore(read, event)
            .request();
    }
}
